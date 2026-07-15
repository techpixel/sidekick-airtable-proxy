import {
  fetchAuthorProjects,
  fetchProjectDetail,
  fetchProjects,
  getProgramStats,
} from "./handlers/projects";
import { fetchProjectTimeline } from "./handlers/timeline";
import { submitReviewAction, updateReviewAction } from "./handlers/review";
import {
  fetchOrders,
  fetchShopItems,
  healthCheck,
  itemNotFound,
  orderNotFound,
  userNotesUnsupported,
} from "./handlers/stubs";
import { invalidAction } from "./errors";

type Handler = (input: Record<string, unknown>) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
  HEALTH_CHECK: healthCheck,
  GET_PROGRAM_STATS: getProgramStats,
  FETCH_PROJECTS: fetchProjects,
  FETCH_PROJECT_DETAIL: fetchProjectDetail,
  FETCH_PROJECT_TIMELINE: fetchProjectTimeline,
  FETCH_AUTHOR_PROJECTS: fetchAuthorProjects,
  SUBMIT_REVIEW_ACTION: submitReviewAction,
  UPDATE_REVIEW_ACTION: updateReviewAction,
  FETCH_SHOP_ITEMS: fetchShopItems,
  FETCH_ORDERS: fetchOrders,
  FETCH_ORDER_DETAIL: orderNotFound,
  REVEAL_ORDER_ADDRESS: orderNotFound,
  UPDATE_ORDER_STATUS: orderNotFound,
  UPDATE_ORDER_FIELDS: orderNotFound,
  UPDATE_ITEM_FIELDS: itemNotFound,
  FETCH_USER_NOTE: userNotesUnsupported,
  UPDATE_USER_NOTE: userNotesUnsupported,
};

export async function dispatch(action: string, input: Record<string, unknown>): Promise<unknown> {
  const handler = handlers[action];
  if (!handler) throw invalidAction(action);
  return handler(input);
}
