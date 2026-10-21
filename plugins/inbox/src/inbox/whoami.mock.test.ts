import { expect, test } from "bun:test";
import whoami from "./whoami";

const mk = (settings: Record<string, string>, env: Record<string, string>): any => ({
    env, fns: { settings: { getString: async (o: any) => settings[o.key] ?? "" } },
});

test("inbox.whoami derives relay, host and principal from the portal audience and OIDC issuer of a Hyper env", async () => {
    const r = await whoami(mk({}, { HYPER_PORTAL_AUDIENCE: "hn:diagrams/dojo/hyper", HYPER_OIDC_ISSUER: "https://hn.hyper-mesh.xyz" }), null, { configPaths: [] });
    expect(r).toEqual({ relay: "https://control.hn.hyper-mesh.xyz", host: "hyper.diagrams.in.hn.hyper-mesh.xyz", principal: "spiffe://hn/diagrams/dojo", source: "env" });
});

test("inbox.whoami: settings override what the env gives, all three settings skip the env", async () => {
    const env = { HYPER_PORTAL_AUDIENCE: "hn:marketing/hyper-node-1/hyper", HYPER_OIDC_ISSUER: "https://hn.hyper-mesh.xyz" };
    expect((await whoami(mk({ host: "Mail.Example.org" }, env), null, { configPaths: [] })).host).toBe("mail.example.org");
    const s = await whoami(mk({ relay: "https://r/", host: "h", principal: "p" }, env), null, { configPaths: [] });
    expect(s).toEqual({ relay: "https://r", host: "h", principal: "p", source: "settings" });
});

test("inbox.whoami refuses with a clear error when the audience is not hn:<tenant>/<node>/<service> and nothing else is set", async () => {
    const ctx = mk({}, { HYPER_PORTAL_AUDIENCE: "https://hyper.zlata.in.hn.hyper-mesh.xyz", HYPER_OIDC_ISSUER: "https://hn.hyper-mesh.xyz" });
    await expect(whoami(ctx, null, { configPaths: [] })).rejects.toThrow(/HYPER_PORTAL_AUDIENCE/);
});
