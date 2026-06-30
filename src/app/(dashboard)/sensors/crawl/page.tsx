import { redirect } from "next/navigation";

// Crawl scope & tuning moved onto the per-district settings page (it's district
// policy, not a fleet-wide knob). Kept as a redirect so old links/bookmarks land
// in the right place.
export default function CrawlScopeRedirect() {
  redirect("/settings/network");
}
