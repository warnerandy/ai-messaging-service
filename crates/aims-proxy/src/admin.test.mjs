import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./admin.js", import.meta.url), "utf8");

test("successful health refresh clears fetch and server errors without erasing action feedback", async () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: "", textContent: "", className: "",
      addEventListener() {}, replaceChildren() {},
    });
    return elements.get(id);
  };
  let unavailable = true;
  let serverError = null;
  const context = vm.createContext({
    URLSearchParams,
    window: { location: { search: "" }, matchMedia: () => ({ matches: false }) },
    document: {
      documentElement: { setAttribute() {} },
      getElementById: element,
    },
    fetch: async () => {
      if (unavailable) throw new Error("Failed to fetch");
      return {
        ok: true,
        json: async () => ({
          connected: true, archive_supported: true, sessions: {}, audit_logs: [],
          error: serverError,
        }),
      };
    },
    setInterval() {},
  });
  vm.runInContext(source, context);
  await new Promise(setImmediate);
  assert.equal(element("connection").textContent, "Unavailable");
  assert.equal(element("feedback").textContent, "Failed to fetch");

  unavailable = false;
  await vm.runInContext("refresh()", context);
  assert.equal(element("connection").textContent, "Connected");
  assert.equal(element("feedback").textContent, "");
  assert.equal(element("feedback").className, "");

  serverError = "AIMS heartbeat response timed out";
  await vm.runInContext("refresh()", context);
  assert.equal(element("feedback").textContent, serverError);
  serverError = null;
  await vm.runInContext("refresh()", context);
  assert.equal(element("feedback").textContent, "");

  unavailable = true;
  await vm.runInContext("refresh()", context);
  element("feedback").textContent = "1 archived in AIMS.";
  unavailable = false;
  await vm.runInContext("refresh()", context);
  assert.equal(element("feedback").textContent, "1 archived in AIMS.");
});
