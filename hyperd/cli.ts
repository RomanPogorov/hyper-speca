#!/usr/bin/env bun
// hyperd CLI: thin wrapper over the unix-socket API.
//   bun hyperd/cli.ts status | start <u> | stop <u> | restart <u> | rm <u> | logs <u> [-f] [--offset N]
//                     run <name> -- <cmd...> | send <u> <text> | attach <u> | events [--after N] [-f] | reload | daemon
//                     install [--target launchd-system|launchd-user|systemd-user|systemd-system] [--out DIR] | doctor
import { call, socketPath } from "./client.ts";
import { defaultTarget, serviceFile, type ServiceTarget } from "./service.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const has = (name: string) => rest.includes(name);
const ago = (t?: number) => !t ? "" : (() => { const s = Math.round((Date.now() - t) / 1000); return s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; })();

async function main() {
    switch (cmd) {
        case undefined: case "status": {
            const st = await call("/status");
            console.log(`hyperd pid ${st.pid}, seq ${st.seq}`);
            for (const u of st.units) {
                const exit = u.lastExit ? ` last exit ${u.lastExit.code ?? u.lastExit.signal} (${u.lastExit.reason})` : "";
                console.log(`${u.name.padEnd(24)} ${u.kind.padEnd(8)} ${u.state.padEnd(9)} pid ${String(u.pid ?? "-").padEnd(7)} up ${ago(u.startedAt).padEnd(5)} run ${u.run}${exit}${u.error ? " error: " + u.error : ""}`);
            }
            return;
        }
        case "start": case "stop": case "restart":
            console.log(JSON.stringify(await call(`/units/${rest[0]}/${cmd}`, { body: {} }), ["name", "state", "run", "pid"])); return;
        case "rm": console.log(JSON.stringify(await call(`/units/${rest[0]}`, { method: "DELETE" }))); return;
        case "reload": console.log(JSON.stringify(await call("/reload", { body: { autostart: true } }), null, 2)); return;
        case "run": {
            const sep = rest.indexOf("--");
            if (!rest[0] || sep < 0) throw new Error("usage: run <name> -- <cmd...>");
            const argv = rest.slice(sep + 1);
            const u = await call("/run", { body: { unit: { name: rest[0], cmd: argv.length === 1 ? argv[0] : argv, cwd: process.cwd(), pty: has("--pty") } } });
            console.log(`started ${u.name} run ${u.run}`); return;
        }
        case "send": await call(`/units/${rest[0]}/input`, { body: { data: rest.slice(1).join(" ") + "\n" } }); return;
        case "logs": {
            let off = Number(flag("--offset") ?? -20000);
            for (;;) {
                const r = await call(`/units/${rest[0]}/logs?offset=${off}&limit=200000`);
                process.stdout.write(r.text);
                off = r.next ?? r.bytes;
                if (!has("-f")) return;
                await Bun.sleep(300);
            }
        }
        case "events": {
            let after = Number(flag("--after") ?? 0);
            for (;;) {
                const r = await call(`/events?after=${after}&wait=${has("-f") ? 30000 : 0}`, { timeoutMs: 40_000 });
                for (const e of r.events) { console.log(JSON.stringify(e)); after = e.seq; }
                if (!has("-f")) return;
            }
        }
        case "attach": {
            const u = await call(`/units/${rest[0]}`);
            const sock = join(u.runDir, "pty.sock");
            if (!existsSync(sock)) throw new Error(`${rest[0]} is not running`);
            const tty = process.stdin.isTTY;
            if (tty) process.stdin.setRawMode(true);
            console.error(`[attached to ${rest[0]}; detach with Ctrl-\\]`);
            const conn = await Bun.connect({ unix: sock, socket: { data(_s, d) { process.stdout.write(d); }, close() { if (tty) process.stdin.setRawMode(false); console.error("\n[process exited]"); process.exit(0); } } });
            process.stdin.on("data", (d: Buffer) => { if (d.length === 1 && d[0] === 0x1c) { if (tty) process.stdin.setRawMode(false); console.error("\n[detached]"); process.exit(0); } conn.write(d); });
            return;
        }
        case "daemon": await import("./main.ts"); return;
        case "install": {
            // Prints (or writes with --out) the OS service file for hyperd and the commands to install it.
            // It never runs sudo itself: installing a system service is the administrator's step.
            const f = serviceFile((flag("--target") ?? defaultTarget()) as ServiceTarget);
            const name = f.path.endsWith(".plist") ? "hyperd.plist" : "hyperd.service";
            const out = flag("--out");
            if (out) { await Bun.write(join(out, name), f.content); console.log(`wrote ${join(out, name)}`); }
            else console.log(`# ${f.path}\n${f.content}`);
            console.log(`# install (from ${out ?? "the directory with " + name}):\n${f.install.join("\n")}\n# check:\n${f.check.join("\n")}\n# uninstall:\n${f.uninstall.join("\n")}`);
            return;
        }
        case "doctor": {
            const checks: Array<[string, boolean, string]> = [];
            const ok = (name: string, pass: boolean, info = "") => { checks.push([name, pass, info]); };
            ok("bun", true, Bun.version);
            let st: any = null;
            try { st = await call("/status"); ok("daemon answers", true, `pid ${st.pid}, ${socketPath()}`); }
            catch (e: any) { ok("daemon answers", false, String(e?.message ?? e) + " — start it: bun hyperd/cli.ts install"); }
            if (st) {
                const ppid = Number(Bun.spawnSync(["ps", "-o", "ppid=", "-p", String(st.pid)]).stdout.toString().trim());
                ok("supervised by the OS", ppid === 1, ppid === 1 ? "parent is init/launchd" : `parent pid ${ppid}: dies with it; install the service`);
                const bad = st.units.filter((u: any) => u.error || u.state === "failed");
                ok("units healthy", bad.length === 0, bad.length ? bad.map((u: any) => `${u.name}: ${u.error ?? u.state}`).join("; ") : `${st.units.length} units`);
                const r = await call("/reload", { body: { autostart: false } });
                ok("unit files valid", r.errors.length === 0, r.errors.join("; ") || `${r.units.length} files`);
                const name = `doctor-${process.pid}`;
                try {
                    await call("/run", { body: { unit: { name, cmd: ["sh", "-c", "tty >/dev/null && echo pty-ok"], pty: true, kind: "task" } } });
                    let text = "";
                    for (let i = 0; i < 40 && !text.includes("pty-ok"); i++) { await Bun.sleep(100); text = (await call(`/units/${name}/logs?offset=0`)).text; }
                    ok("pty run", text.includes("pty-ok"), text.trim().slice(0, 60));
                } finally { await call(`/units/${name}`, { method: "DELETE" }).catch(() => undefined); }
            }
            for (const [n, p, i] of checks) console.log(`${p ? "ok  " : "FAIL"} ${n.padEnd(22)} ${i}`);
            if (checks.some((c) => !c[1])) process.exitCode = 1;
            return;
        }
        default: throw new Error(`unknown command ${cmd}`);
    }
}
main().catch((e) => {
    const msg = String(e?.message ?? e);
    console.error(/ENOENT|ECONNREFUSED|FailedToOpenSocket|Unable to connect/.test(msg) ? `hyperd is not running (${socketPath()})` : msg);
    process.exit(1);
});
