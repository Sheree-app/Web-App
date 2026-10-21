/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as lib_identity from "../lib/identity.js";
import type * as lib_presence from "../lib/presence.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_supabase from "../lib/supabase.js";
import type * as lib_users from "../lib/users.js";
import type * as lib_views from "../lib/views.js";
import type * as lifecycle from "../lifecycle.js";
import type * as maintenance from "../maintenance.js";
import type * as messages from "../messages.js";
import type * as notifications from "../notifications.js";
import type * as presence from "../presence.js";
import type * as priceCards from "../priceCards.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  conversations: typeof conversations;
  crons: typeof crons;
  "lib/identity": typeof lib_identity;
  "lib/presence": typeof lib_presence;
  "lib/roles": typeof lib_roles;
  "lib/supabase": typeof lib_supabase;
  "lib/users": typeof lib_users;
  "lib/views": typeof lib_views;
  lifecycle: typeof lifecycle;
  maintenance: typeof maintenance;
  messages: typeof messages;
  notifications: typeof notifications;
  presence: typeof presence;
  priceCards: typeof priceCards;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
