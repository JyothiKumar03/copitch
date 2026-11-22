import type { TSiteWallKind } from "../../../shared/site-run";
import type { TSiteElement, TSiteObservation } from "../types/site-run";
import { same_destination, website_capture_url } from "./website-capture";

const consequential = /(?:^|[^\p{L}\p{N}])(?:buy|purchase|pay|delete|remove|send|publish|invite|subscribe|unsubscribe|transfer|logout|log[ -]?out|sign[ -]?out|confirm(?:[ -]purchase)?|place[ -]order|order[ -]now|submit|save)(?:$|[^\p{L}\p{N}])/iu;
const account = /(?:^|[^\p{L}\p{N}])(?:account|accounts|auth|oauth|log[ -]?in|sign[ -]?(?:in|up)|register|password|reset[ -]password)(?:$|[^\p{L}\p{N}])/iu;
const account_control = /^(?:my account|create (?:an? |your )?account|register(?: now| here)?|log[ -]?in|sign[ -]?(?:in|up)|reset (?:your )?password)(?:$|\s+(?:to|with|for|now|here)\b)/iu;
const payment = /(?:^|[^\p{L}\p{N}])(?:checkout|billing|payments?|payment[ -]method|shopping[ -]cart)(?:$|[^\p{L}\p{N}])/iu;
const challenge = /(?:^|[^\p{L}\p{N}])(?:captcha|recaptcha|hcaptcha|turnstile|bot[ -]check|verify (?:that )?you are human)(?:$|[^\p{L}\p{N}])/iu;
const sensitive_path = /(?:^|\/)(?:api|graphql|admin|download|uploads?)(?:\/|$)/iu;
const document_suffix = /\.(?:apk|avi|css|csv|docx?|dmg|exe|gif|gz|ico|jpe?g|m?js|json|mov|mp[34]|pdf|png|pptx?|svg|tar|ttf|webp|woff2?|xlsx?|xml|zip)$/iu;
const asset_suffix = /\.(?:avif|css|eot|gif|ico|jpe?g|m?js|otf|png|svg|ttf|webp|woff2?)$/iu;

export const site_wall_reason: Record<TSiteWallKind, string> = {
  off_site: "The link leaves the approved website.",
  skipped_consequential: "This action could change the website or send information.",
  needs_account: "This part of the website requires an account.",
  bot_check: "The website requires a human verification check.",
  payment: "This page handles checkout or payment.",
  dead_end: "No reachable page or new content was found here.",
  outside_depth: "This page is past the approved crawl depth.",
  repeated: "This action has already been tried.",
  unavailable: "The page could not be opened safely.",
};

const path_of = (url: URL) => {
  try { return decodeURIComponent(url.pathname).replace(/[-_]/gu, " "); }
  catch { return ""; }
};

export const site_navigation = (root: URL, value: string, asset = false): { url: URL } | { wall: TSiteWallKind } => {
  const url = website_capture_url(value);
  if (!url || !same_destination(root, url)) return { wall: "off_site" };
  // Agent navigation carries no page-controlled query. Static asset version keys are bounded by the pinned reader.
  const path = path_of(url);
  if (!path || /%[0-9a-f]{2}|[\\\p{Cc}]/iu.test(path)) return { wall: "unavailable" };
  if (payment.test(path)) return { wall: "payment" };
  if (challenge.test(path)) return { wall: "bot_check" };
  if (consequential.test(path) || /(?:^|\/)orders?(?:\/|$)/iu.test(path) || sensitive_path.test(path)) return { wall: "skipped_consequential" };
  if (account.test(path)) return { wall: "needs_account" };
  if (asset ? !asset_suffix.test(url.pathname) : !!url.search || document_suffix.test(url.pathname)) return { wall: "unavailable" };
  return { url };
};

export const site_element_wall = (element: TSiteElement): TSiteWallKind | undefined => {
  if (!element.enabled) return "unavailable";
  if (payment.test(element.name)) return "payment";
  if (challenge.test(element.name)) return "bot_check";
  if (consequential.test(element.name) || /^order$/iu.test(element.name.trim()) || element.role === "submit") return "skipped_consequential";
  if (account_control.test(element.name.trim())) return "needs_account";
  if (!["link", "tab", "button", "combobox", "switch"].includes(element.role)) return "unavailable";
};

export const site_page_wall = (page: Pick<TSiteObservation, "title" | "password_field" | "payment_field" | "challenge">): TSiteWallKind | undefined => {
  if (page.challenge || challenge.test(page.title)) return "bot_check";
  if (page.payment_field || payment.test(page.title)) return "payment";
  if (page.password_field) return "needs_account";
};
