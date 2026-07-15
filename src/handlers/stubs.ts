import { invalidAction, notFound } from "../errors";
import pkg from "../../package.json";

// This program has no shop and no user notes. Order/item lookups can never
// succeed (nothing exists), and user notes signal "unimplemented" per protocol.

export function healthCheck(): unknown {
  return { ok: true, version: pkg.version };
}

export function fetchShopItems(): unknown {
  return { items: [] };
}

export function fetchOrders(): unknown {
  return { orders: [], items: {}, totalCount: 0 };
}

export function orderNotFound(): never {
  throw notFound("This program has no orders.");
}

export function itemNotFound(): never {
  throw notFound("This program has no shop items.");
}

export function userNotesUnsupported(): never {
  throw invalidAction("FETCH_USER_NOTE / UPDATE_USER_NOTE (user notes are not supported)");
}
