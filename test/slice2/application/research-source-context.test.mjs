import assert from "node:assert/strict";
import { test } from "node:test";
import {
  researchCitationInventory,
  candidateSourceCitations,
  selectResearchSourceExcerpt,
} from "../../../packages/application/dist/research-source-context.js";

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
