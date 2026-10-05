import assert from "node:assert/strict";
import { test } from "node:test";
import {
  researchCitationInventory,
  researchExtractionCitationInventory,
  candidateSourceCitations,
  selectResearchSourceExcerpt,
  prioritizeSourceBackedCandidates,
} from "../../../packages/application/dist/research-source-context.js";

test("L08 R1 extraction dependencies retain inherited and approved-method sources without sibling arrival order", () => {
  const own = {
    url: "https://own.example/products",
    title: "Own",
    content: "Own evidence",
  };
  const method = {
    url: "https://registry.example/company",
    title: "Approved registry",
    content: "Registry evidence",
  };
  const inherited = new Map([
    [
      "https://prior.example/price",
      { text: "Historical price, original date" },
    ],
  ]);
  const shared = new Map([
    ["https://sibling.example/products", { text: "Sibling evidence" }],
    [own.url, { text: "Own page" }],
    ...inherited,
    [method.url, { text: "Registry page" }],
  ]);
  const before = structuredClone([...shared]);
  const first = researchExtractionCitationInventory(
    [own],
    [method],
    inherited,
    shared,
  );
  const reversed = new Map([...shared].reverse());
  reversed.set("https://later-sibling.example/", { text: "Later evidence" });
  assert.deepEqual(
    researchExtractionCitationInventory([own], [method], inherited, reversed),
    first,
  );
  assert.deepEqual(
    first.map((source) => source.url),
    [own.url, "https://prior.example/price", method.url].sort(),
  );
  assert.deepEqual(
    first.find((source) => source.url === own.url),
    own,
  );
  assert.deepEqual(
    first.find((source) => source.url === method.url),
    method,
  );
  assert.deepEqual([...shared], before);
  assert.equal(
    researchCitationInventory([own], [method], shared).some(
      (source) => source.url === "https://sibling.example/products",
    ),
    true,
    "Final source inventory remains complete",
  );
});

test("L04 grounded late leads precede empty names before the extraction cap without changing evidence", () => {
  const empty = Array.from({ length: 10 }, (_, i) => ({
    legal_name: `Unbacked ${i}`,
    anchor_quote: `Unbacked ${i}`,
    source_urls: [],
  }));
  const supported = {
    legal_name: "Ocean Logistics Limited",
    anchor_quote: "Ocean Logistics Limited",
    source_urls: ["https://ocean.example/about"],
  };
  const native = [
    {
      url: supported.source_urls[0],
      title: "About",
      content: "Ocean Logistics Limited provides ocean freight.",
    },
  ];
  const inputs = [...empty, supported];
  const before = structuredClone(inputs);
  const prioritized = prioritizeSourceBackedCandidates(inputs, native);
  assert.equal(prioritized.slice(0, 4)[0], supported);
  assert.equal(prioritized.length, inputs.length);
  assert.deepEqual(inputs, before);
  assert.deepEqual(prioritized.slice(1), empty);
});

test("L04 short company names do not acquire unrelated source assignments through word substrings", () => {
  const candidate = { legal_name: "ONE", anchor_quote: "ONE", source_urls: [] };
  const unrelated = {
    url: "https://unrelated.example/",
    title: "Someone",
    content: "Someone offers container shipping.",
  };
  const own = {
    url: "https://one.example/",
    title: "ONE",
    content: "ONE provides container shipping.",
  };
  assert.deepEqual(candidateSourceCitations(candidate, [unrelated, own]), [
    own,
  ]);
});

test("L14 continuation keeps fetched seller evidence even when previous extraction accepted no facts", () => {
  const old = {
    url: "https://seller.example/about",
    title: "Seller",
    content: "Seller Limited",
  };
  const product = "https://seller.example/products/model-123";
  const current = {
    url: "https://manufacturer.example/datasheet",
    title: "Datasheet",
    content: "Model-123",
  };
  const fetched = new Map([
    [
      product,
      {
        url: product,
        text: "Seller Limited supplies Model-123",
        retrieved_at: "2026-09-09T00:00:00Z",
        content_sha256: "a".repeat(64),
      },
    ],
  ]);
  const inventory = researchCitationInventory([current], [old], fetched);
  assert.deepEqual(
    new Set(inventory.map((entry) => entry.url)),
    new Set([old.url, product, current.url]),
  );
  assert.equal(
    inventory.find((entry) => entry.url === old.url).content,
    old.content,
  );
  assert.equal(fetched.size, 1);
});

test("L14 candidate context includes its contact and product pages but not unrelated sellers", () => {
  const citations = [
    {
      url: "https://seller.example/about",
      title: "About",
      content: "Seller Limited",
    },
    {
      url: "https://www.seller.example/product",
      title: "Product",
      content: "Model-123",
    },
    {
      url: "https://seller.example/contact",
      title: "Contact",
      content: "sales@seller.example",
    },
    {
      url: "https://other.example/product",
      title: "Other",
      content: "Other Limited Model-123",
    },
  ];
  const scoped = candidateSourceCitations(
    {
      legal_name: "Seller Limited",
      anchor_quote: "Seller Limited",
      source_urls: [citations[0].url],
    },
    citations,
  );
  assert.deepEqual(
    scoped.map((entry) => entry.url),
    citations.slice(0, 3).map((entry) => entry.url),
  );
});

test("L14 excerpt selection retains identity, contact, price and sold-out evidence after long navigation", () => {
  const text =
    "Navigation and unrelated categories. ".repeat(600) +
    "\nCompany name: Aster Limited\n" +
    "Services. ".repeat(250) +
    "\nModel-123 price AED230.00 Sold out\n" +
    "Description. ".repeat(200) +
    "\nContact us: sales@aster.example Phone +971 4 282 8931\n";
  const excerpt = selectResearchSourceExcerpt(text, "Model-123 Aster Limited");
  assert.ok(excerpt.length <= 5800);
  for (const value of [
    "Aster Limited",
    "Model-123",
    "AED230.00 Sold out",
    "sales@aster.example",
  ])
    assert.ok(excerpt.includes(value), value);
  for (const passage of excerpt.split("\n[Separate source excerpt]\n"))
    assert.ok(text.includes(passage));
});
