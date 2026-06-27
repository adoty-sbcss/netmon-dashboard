/**
 * Plain-language definitions for the network jargon that surfaces in the UI.
 * One source of truth so in-context tooltips (see `info-tip.tsx`) stay
 * consistent. Each entry is written for a competent site tech who isn't
 * necessarily a network engineer — a sentence or two, no deeper acronyms.
 */
export const GLOSSARY = {
  lldp:
    "LLDP (Link Layer Discovery Protocol) — how switches announce themselves to whatever's plugged into them, so we can map what's physically wired to what.",
  cdp:
    "CDP (Cisco Discovery Protocol) — Cisco's equivalent of LLDP for finding directly-connected neighbors.",
  lldpCdp:
    "LLDP/CDP — the protocols switches use to announce themselves to their neighbors. We read them to map what's physically wired to what.",
  bridgeTable:
    "Bridge table (a switch's MAC address table) — the list of which device is seen on which switch port. We use it to attach hosts to the right port.",
  neighbors:
    "Neighbors — devices directly wired to a switch, discovered automatically via LLDP/CDP.",
  snmp:
    "SNMP (Simple Network Management Protocol) — lets the sensor read status and counters from managed switches. It needs a read 'community' string to work.",
  snmpGap:
    "SNMP gap — a device we expected to answer SNMP but didn't. Usually a missing or wrong community string, or a device that isn't SNMP-managed.",
  spineCrawl:
    "Spine crawl — following SNMP from switch to switch across the backbone to map the full topology, not just what one sensor can see directly.",
  oui:
    "OUI — the first half of a MAC address, which identifies the hardware vendor (e.g. Cisco, Aruba).",
  nxdomain:
    "NXDOMAIN — a DNS 'no such name' answer. The domain doesn't exist, or a filter/resolver blocked it.",
  vlan:
    "VLAN — a Virtual LAN: a logically separate network carried over the same physical switches.",
  trunk:
    "Trunk (802.1Q) — a switch port that carries several VLANs at once, rather than a single access VLAN.",
  stp:
    "STP (Spanning Tree Protocol) — keeps the network loop-free by blocking redundant links between switches.",
  dhcp:
    "DHCP — the service that hands out IP addresses (and gateway/DNS settings) to devices on the network.",
  idf:
    "IDF (Intermediate Distribution Frame) — a wiring closet where access switches live, fanning out to the rooms it serves.",
  iperf:
    "iperf — a point-to-point bandwidth test that measures real throughput between two boxes.",
  cidr:
    "CIDR notation — an IP range written like 10.6.0.0/22, where the /number says how big the subnet is.",
} as const;

export type GlossaryTerm = keyof typeof GLOSSARY;
