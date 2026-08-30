import { createHash } from "node:crypto";

function serialize(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${path}`);
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Non-JSON value at ${path}`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`Cyclic value at ${path}`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.some(
          (key) =>
            typeof key === "symbol" ||
            (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
        )
      ) {
        throw new TypeError(`Non-JSON array property at ${path}`);
      }
      const children: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError(`Sparse array at ${path}[${index}]`);
        }
        children.push(serialize(value[index], `${path}[${index}]`, ancestors));
      }
      return `[${children.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Non-plain object at ${path}`);
    }

    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === "symbol")) {
      throw new TypeError(`Symbol key at ${path}`);
    }

    const stringKeys = keys as string[];
    const properties = stringKeys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        throw new TypeError(`Non-data property at ${path}.${key}`);
      }
      return [key, descriptor.value] as const;
    });

    properties.sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${properties
      .map(
        ([key, child]) =>
          `${JSON.stringify(key)}:${serialize(child, `${path}.${key}`, ancestors)}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalSerialize(value: unknown): string {
  return serialize(value, "$", new WeakSet<object>());
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalSerialize(value), "utf8")
    .digest("hex");
}
