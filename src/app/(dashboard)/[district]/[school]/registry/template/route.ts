import { CSV_COLUMNS } from "@/lib/registry/types";

/** Downloadable CSV template matching the equipment-registry import columns. */
export async function GET() {
  const header = CSV_COLUMNS.join(",");
  const examples = [
    "Main IDF Switch,switch,10.0.0.2,aa:bb:cc:00:11:22,Cisco,C9300-48P,Main,IDF-1,snmp,public,17.09.04,active,Core access switch",
    "Library Printer,printer,10.0.5.40,,HP,LaserJet M507,Library,,icmp,,,active,",
    "Door Controller,other,10.0.9.12,,,,Gym,,none,,,active,Brivo access panel",
  ];
  const body = [header, ...examples].join("\r\n") + "\r\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="netmon-registry-template.csv"',
    },
  });
}
