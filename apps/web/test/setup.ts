import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

document.documentElement.lang = "en";
document.title = "MatchBASE synthetic reference path";

afterEach(() => cleanup());
