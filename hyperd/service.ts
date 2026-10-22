// Service files that make the OS supervise hyperd itself: launchd on macOS, systemd on Linux.
// Generated from the running environment (bun path, this checkout, user, HOME) so nothing is hard-coded.
import { homedir, userInfo } from "node:os";
import { resolve } from "node:path";

export type ServiceTarget = "launchd-system" | "launchd-user" | "systemd-user" | "systemd-system";

export interface ServiceFile { target: ServiceTarget; path: string; content: string; install: string[]; uninstall: string[]; check: string[] }

// systemd: quote an argument that has spaces or quotes; "%" is a specifier and must be doubled
const q = (s: string) => /[\s"\\]/.test(s) ? `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"` : s.replace(/%/g, "%%");
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function serviceFile(target: ServiceTarget, o: { bun?: string; repo?: string; user?: string; home?: string; path?: string } = {}): ServiceFile {
    // the stable shim on PATH (e.g. /opt/homebrew/bin/bun), not the versioned Cellar path that breaks on upgrade
    const bun = o.bun ?? Bun.which("bun") ?? process.execPath;
    const repo = o.repo ?? resolve(import.meta.dir, "..");
    const user = o.user ?? userInfo().username;
    const home = o.home ?? homedir();
    const PATH = o.path ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    const main = `${repo}/hyperd/main.ts`;
    const log = `${home}/.hyper/run/hyperd/daemon.log`;
    if (target === "launchd-system" || target === "launchd-user") {
        const label = "com.hyper.hyperd";
        const system = target === "launchd-system";
        const path = system ? `/Library/LaunchDaemons/${label}.plist` : `${home}/Library/LaunchAgents/${label}.plist`;
        const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
${system ? `  <key>UserName</key><string>${xml(user)}</string>\n` : ""}  <key>ProgramArguments</key><array><string>${xml(bun)}</string><string>${xml(main)}</string></array>
  <key>WorkingDirectory</key><string>${xml(repo)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(PATH)}</string><key>HOME</key><string>${xml(home)}</string><key>HYPERD_SUPERVISED</key><string>1</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>AbandonProcessGroup</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;
        const domain = system ? "system" : "gui/$(id -u)";
        const sudo = system ? "sudo " : "";
        return {
            target, path, content,
            install: [
                `mkdir -p ${home}/.hyper/run/hyperd`,
                system ? `sudo install -m 644 -o root -g wheel hyperd.plist ${path}` : `install -m 644 hyperd.plist ${path}`,
                `${sudo}launchctl bootstrap ${domain} ${path}`,
            ],
            uninstall: [`${sudo}launchctl bootout ${domain}/${label}`, `${sudo}rm ${path}`],
            check: [`${sudo}launchctl print ${domain}/${label} | grep -E "state|pid ="`, `${bun} ${repo}/hyperd/cli.ts status`],
        };
    }
    const system = target === "systemd-system";
    const path = system ? "/etc/systemd/system/hyperd.service" : `${home}/.config/systemd/user/hyperd.service`;
    // KillMode=process: stopping hyperd must not take its holders (and your services) down with it.
    const content = `[Unit]
Description=hyperd process supervisor
After=network.target

[Service]
Type=simple
${system ? `User=${user}\n` : ""}WorkingDirectory=${repo}
Environment=${q(`HOME=${home}`)}
Environment=${q(`PATH=${PATH}`)}
Environment=HYPERD_SUPERVISED=1
ExecStart=${q(bun)} ${q(main)}
Restart=always
RestartSec=2
KillMode=process

[Install]
WantedBy=${system ? "multi-user.target" : "default.target"}
`;
    const sc = system ? "sudo systemctl" : "systemctl --user";
    return {
        target, path, content,
        install: [
            system ? `sudo install -m 644 hyperd.service ${path}` : `mkdir -p ${home}/.config/systemd/user && install -m 644 hyperd.service ${path}`,
            ...(system ? [] : [`loginctl enable-linger ${user}   # keep user services running without a login session`]),
            `${sc} daemon-reload`, `${sc} enable --now hyperd`,
        ],
        uninstall: [`${sc} disable --now hyperd`, `${system ? "sudo " : ""}rm ${path}`, `${sc} daemon-reload`],
        check: [`${sc} status hyperd --no-pager`, `${bun} ${repo}/hyperd/cli.ts status`],
    };
}

/** Best target for this machine: system launchd on macOS (works without a GUI login), user systemd on Linux. */
export function defaultTarget(): ServiceTarget {
    return process.platform === "darwin" ? "launchd-system" : "systemd-user";
}
