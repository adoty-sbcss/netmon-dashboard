/**
 * Azure read layer for the Infrastructure view + the monthly summary. Uses the
 * app's managed identity in prod (DefaultAzureCredential → the user-assigned
 * identity, granted Reader / Monitoring Reader / Cost Management Reader on the
 * RG) and the az-CLI login locally. ARM is called via REST with a bearer token
 * so we don't pull in the heavy per-service ARM SDKs.
 *
 * No `server-only` + no DB imports so the cost-snapshot + report cron jobs can
 * import it under tsx.
 */
import { DefaultAzureCredential } from "@azure/identity";

const SUBSCRIPTION_ID =
  process.env.AZURE_SUBSCRIPTION_ID || "50625b52-471d-4c57-a83b-c502cf52c80c";
const RESOURCE_GROUP =
  process.env.AZURE_RESOURCE_GROUP || "W2-SBCSS-District-NetMon-Dashboard";

const ARM = "https://management.azure.com";

let _cred: DefaultAzureCredential | null = null;
function credential(): DefaultAzureCredential {
  return (_cred ??= new DefaultAzureCredential());
}

async function armToken(): Promise<string> {
  const tok = await credential().getToken(`${ARM}/.default`);
  if (!tok?.token) throw new Error("could not acquire an ARM token");
  return tok.token;
}

async function armPost(path: string, apiVersion: string, body: unknown): Promise<unknown> {
  const token = await armToken();
  const res = await fetch(`${ARM}${path}?api-version=${apiVersion}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`ARM POST ${path} → ${res.status}: ${txt.slice(0, 400)}`);
  }
  return res.json();
}

export const azureScope = { subscriptionId: SUBSCRIPTION_ID, resourceGroup: RESOURCE_GROUP };

// --- cost -------------------------------------------------------------------

export interface CostByService {
  service: string;
  cost: number;
}

export interface ResourceGroupCost {
  currency: string;
  total: number;
  byService: CostByService[];
  /** 'MonthToDate' | 'BillingMonthToDate' | a custom label. */
  timeframe: string;
}

interface CostQueryResponse {
  properties?: {
    columns?: { name: string; type: string }[];
    rows?: (string | number)[][];
  };
}

/**
 * Actual cost for the resource group over the timeframe, grouped by service,
 * highest first. Cost data lags ~8–24h, so this is "spend so far," not live.
 */
export async function getResourceGroupCost(
  timeframe: "MonthToDate" | "BillingMonthToDate" = "MonthToDate",
): Promise<ResourceGroupCost> {
  const json = (await armPost(
    `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.CostManagement/query`,
    "2023-11-01",
    {
      type: "ActualCost",
      timeframe,
      dataset: {
        granularity: "None",
        aggregation: { totalCost: { name: "Cost", function: "Sum" } },
        grouping: [{ type: "Dimension", name: "ServiceName" }],
      },
    },
  )) as CostQueryResponse;

  const cols = json.properties?.columns?.map((c) => c.name) ?? [];
  const rows = json.properties?.rows ?? [];
  const iCost = cols.indexOf("Cost");
  const iSvc = cols.indexOf("ServiceName");
  const iCur = cols.indexOf("Currency");

  let total = 0;
  let currency = "USD";
  const byService: CostByService[] = [];
  for (const r of rows) {
    const cost = Number(r[iCost] ?? 0);
    if (iCur >= 0 && r[iCur]) currency = String(r[iCur]);
    total += cost;
    byService.push({ service: String(r[iSvc] ?? "unknown"), cost });
  }
  byService.sort((a, b) => b.cost - a.cost);
  return { currency, total: Math.round(total * 100) / 100, byService, timeframe };
}
