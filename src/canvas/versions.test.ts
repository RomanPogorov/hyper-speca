import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { reqCtx } from "../$test";

const page = (body: string) => `<p>${body}</p><script>window.n = 1</script>`;

test("a tab's draft: writes join per answer, undo and redo, versions saved on purpose and brought back", async () => {
    const ctx: any = await mkTestCtx();
    const r: any = reqCtx(ctx);
    const a = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent: a });

    const tab = await ctx.fns.canvas.show({ agentId: a.id, kind: "html", title: "Plan", args: { html: page("one") } });
    expect(tab).toMatchObject({ version: 1, draftEdits: 0 });
    expect((await ctx.fns.canvas.versions({ itemId: tab.id })).map((v: any) => v.v)).toEqual([1]);

    // Two writes of one answer are one step; another answer is another.
    await ctx.fns.canvas.write({ itemId: tab.id, args: { html: page("two") }, note: "two", author: "agent", turn: "t1" });
    await ctx.fns.canvas.edit({ itemId: tab.id, edits: [{ old: "two", new: "three" }], note: "three", author: "agent", turn: "t1" });
    let draft = await ctx.fns.canvas.draft({ itemId: tab.id });
    expect(draft.edits.length).toBe(1);
    await ctx.fns.canvas.write({ itemId: tab.id, args: { html: page("four") }, note: "four", author: "agent", turn: "t2" });
    draft = await ctx.fns.canvas.draft({ itemId: tab.id });
    expect(draft.edits.map((e: any) => e.note)).toEqual(["two · three", "four"]);
    expect((await ctx.fns.canvas.tab({ itemId: tab.id })).draftEdits).toBe(2);

    // Undo goes back one answer, redo forward; a new write after an undo ends the redo.
    const undone = await ctx.fns.canvas.undo({ itemId: tab.id });
    expect(undone.undone.note).toBe("four");
    expect(undone.item.args.html).toContain("three");
    const redone = await ctx.fns.canvas.redo({ itemId: tab.id });
    expect(redone.item.args.html).toContain("four");
    await ctx.fns.canvas.undo({ itemId: tab.id });
    await ctx.fns.canvas.undo({ itemId: tab.id });
    expect((await ctx.fns.canvas.tab({ itemId: tab.id })).args.html).toContain("one");
    expect((await ctx.fns.canvas.undo({ itemId: tab.id })).undone).toBeNull();
    await ctx.fns.canvas.redo({ itemId: tab.id });
    await ctx.fns.canvas.write({ itemId: tab.id, args: { html: page("five") }, note: "five", author: "user:1" });
    expect((await ctx.fns.canvas.redo({ itemId: tab.id })).redone).toBeNull();

    // A version is saved only on purpose, with the draft's changes; then the draft starts over.
    const saved = await ctx.fns.canvas.commit({ itemId: tab.id, name: "Five" });
    expect(saved).toMatchObject({ committed: true, v: 2, item: { version: 2, draftEdits: 0 } });
    expect((await ctx.fns.canvas.commit({ itemId: tab.id })).committed).toBe(false);
    const list = await ctx.fns.canvas.versions({ itemId: tab.id });
    expect(list.map((v: any) => [v.v, v.name])).toEqual([[2, "Five"], [1, null]]);
    expect(list[0].changes.map((c: any) => c.note)).toEqual(["two · three", "five"]);
    expect((await ctx.fns.canvas.version({ itemId: tab.id, v: 1 })).args.html).toContain("one");

    // Undo after a save stops at the saved version.
    await ctx.fns.canvas.write({ itemId: tab.id, args: { html: page("six") }, author: "user:1" });
    await ctx.fns.canvas.undo({ itemId: tab.id });
    expect((await ctx.fns.canvas.tab({ itemId: tab.id })).args.html).toContain("five");

    // Bringing back v1 is a new edit that can be undone; revertTo 0 drops the draft.
    const back = await ctx.fns.canvas.restore({ itemId: tab.id, v: 1, author: "user:1" });
    expect(back.args.html).toContain("one");
    expect((await ctx.fns.canvas.draft({ itemId: tab.id })).edits.at(-1).note).toBe("restored v1");
    await ctx.fns.canvas.revertTo({ itemId: tab.id, n: 0 });
    expect((await ctx.fns.canvas.tab({ itemId: tab.id })).args.html).toContain("five");
    expect((await ctx.fns.canvas.renameVersion({ itemId: tab.id, v: 2, name: "Final" })).renamed).toBe(true);
    expect((await ctx.fns.canvas.versions({ itemId: tab.id }))[0].name).toBe("Final");
    await expect(ctx.fns.canvas.tab({ itemId: tab.id, agentId: "nobody" })).rejects.toThrow("no tab");
});

test("canvas.edit replaces exact snippets, all or none", async () => {
    const ctx: any = await mkTestCtx();
    const r: any = reqCtx(ctx);
    const a = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent: a });
    const tab = await ctx.fns.canvas.show({ agentId: a.id, kind: "html", title: "Edit", args: { html: page("a b a") } });
    await expect(ctx.fns.canvas.edit({ itemId: tab.id, edits: [{ old: "a", new: "x" }] })).rejects.toThrow("found 2 times");
    await expect(ctx.fns.canvas.edit({ itemId: tab.id, edits: [{ old: "b", new: "y" }, { old: "zzz", new: "q" }] })).rejects.toThrow("not found");
    expect((await ctx.fns.canvas.tab({ itemId: tab.id })).args.html).toContain("a b a");
    const done = await ctx.fns.canvas.edit({ itemId: tab.id, edits: [{ old: "a", new: "x", all: true }, { old: "b", new: "y" }], note: "letters" });
    expect(done.args.html).toContain("x y x");
    expect(done.draftEdits).toBe(1);
});

test("comments: pinned, answered, sent together, resolved", async () => {
    const ctx: any = await mkTestCtx();
    const r: any = reqCtx(ctx);
    const a = await r.fns.agent.start({ model: "mock:echo" });
    await r.fns.session.save({ agent: a });
    const tab = await ctx.fns.canvas.show({ agentId: a.id, kind: "html", title: "Pricing", args: { html: page("price") } });
    const c1 = await ctx.fns.canvas.addComment({ itemId: tab.id, text: "Bigger", quote: "price", target: { path: "p" }, author: "user:1" });
    await ctx.fns.canvas.addComment({ itemId: tab.id, text: "Green button", author: "user:1" });
    expect(c1).toMatchObject({ text: "Bigger", quote: "price", status: "open", sentAt: null, target: { path: "p" } });

    const sent = await ctx.fns.canvas.sendComments({ itemId: tab.id });
    expect(sent.ids.length).toBe(2);
    expect(sent.text).toContain("«price»: Bigger");
    expect(sent.text).toContain("Green button");
    expect((await ctx.fns.canvas.sendComments({ itemId: tab.id })).text).toBe("");

    const done = await ctx.fns.canvas.resolveComment({ id: c1.id, reply: "Made it 24px" });
    expect(done).toMatchObject({ status: "resolved", replies: [{ text: "Made it 24px", author: "user" }] });
    expect((await ctx.fns.canvas.comments({ itemId: tab.id })).map((c: any) => c.text)).toEqual(["Green button"]);
    expect((await ctx.fns.canvas.comments({ itemId: tab.id, all: true })).length).toBe(2);

    // A person removes only their own comments, with the thread.
    await ctx.fns.canvas.addComment({ itemId: tab.id, text: "Agent note", author: "agent" });
    expect((await ctx.fns.canvas.removeComments({ itemId: tab.id, author: "user:2" })).removed).toBe(0);
    expect((await ctx.fns.canvas.removeComments({ itemId: tab.id, author: "user:1", ids: [c1.id] })).removed).toBe(1);
    expect((await ctx.fns.canvas.comments({ itemId: tab.id, all: true })).map((c: any) => c.text)).toEqual(["Green button", "Agent note"]);
    const n = await ctx.fns.procs.db.select({ sql: "SELECT count(*)::int AS n FROM canvas_comments WHERE item_id = ?", params: [tab.id] });
    expect(n[0].n).toBe(2);
});
