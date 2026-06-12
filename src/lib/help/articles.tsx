/**
 * Help center content. File-based (version-controlled) so articles ship with
 * the app and review like code — no DB or in-app editor needed for v1.
 *
 * To add an article: append a HelpArticle to HELP_ARTICLES. Keep entries as
 * easy as possible — short steps, copy-able code, screenshots. When a step
 * edits a file on a sensor/Linux box, ALWAYS show a command-line edit (sed,
 * etc.), never "open it in a text editor."
 *
 * Screenshots live in /public/help/<file>.png and are referenced by the
 * `image` block. Until a PNG exists, the renderer shows a labeled placeholder,
 * so the page is presentable before the screenshot is captured.
 */
import type { ReactNode } from "react";

export type HelpBlock =
  | { kind: "h"; text: string }
  | { kind: "p"; text: ReactNode }
  | { kind: "steps"; items: ReactNode[] }
  | { kind: "code"; code: string; caption?: string }
  | { kind: "image"; src: string; alt: string; caption?: string }
  | { kind: "callout"; tone: "info" | "warn" | "success"; text: ReactNode };

export interface HelpArticle {
  slug: string;
  title: string;
  summary: string;
  category: string;
  /** ISO date (YYYY-MM-DD) shown as "Updated …". */
  updated: string;
  blocks: HelpBlock[];
}

const C = (s: string) => <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{s}</code>;

const fixEnrollment: HelpArticle = {
  slug: "sensor-did-not-enroll",
  title: "Fix a sensor that didn't enroll",
  summary:
    "A sensor is uploading data but never shows up as enrolled under Sensors. Get it talking to the dashboard's control plane in a few commands.",
  category: "Sensors",
  updated: "2026-06-05",
  blocks: [
    {
      kind: "callout",
      tone: "info",
      text: (
        <>
          <strong>Symptom:</strong> the sensor&apos;s scans are arriving (you see it
          under a school) but on its detail page <strong>Last check-in</strong> reads
          &ldquo;no check-in yet&rdquo; and <strong>Reported config</strong> reads
          &ldquo;not yet reported.&rdquo; The box can reach SFTP but isn&apos;t
          completing the control-plane check-in. Heads up: the{" "}
          <strong>Enrollment</strong> badge can still say &ldquo;enrolled&rdquo; if a
          token was once issued — what actually matters is whether the box has{" "}
          <em>checked in</em>.
        </>
      ),
    },
    {
      kind: "image",
      src: "/help/sensor-offline.png",
      alt: "Sensor detail page: Last check-in 'no check-in yet' and Reported config 'not yet reported'",
      caption: "A sensor that isn't completing check-in — note “no check-in yet” and “not yet reported.”",
    },
    { kind: "h", text: "What you'll need" },
    {
      kind: "steps",
      items: [
        <>Terminal access to the sensor — SSH or a console/keyboard — as a user that can run {C("sudo")}.</>,
        <>The dashboard&apos;s <strong>bootstrap key</strong> (Step 1 shows where to get it).</>,
        <>About 3 minutes.</>,
      ],
    },

    { kind: "h", text: "1. Confirm auto-enrollment is on and copy the bootstrap key" },
    {
      kind: "p",
      text: (
        <>
          In the dashboard go to <strong>Settings → SFTP ingestion → Sensor
          auto-enrollment</strong>. Make sure <strong>Allow boxes to self-enroll</strong>{" "}
          is checked, then copy the <strong>Current bootstrap key</strong>.
        </>
      ),
    },
    {
      kind: "image",
      src: "/help/enroll-settings.png",
      alt: "Sensor auto-enrollment settings showing the self-enroll toggle and bootstrap key",
      caption: "Settings → SFTP ingestion → Sensor auto-enrollment",
    },
    {
      kind: "callout",
      tone: "warn",
      text: (
        <>
          If the toggle is <strong>off</strong>, no new box can register. Turn it on
          and click <strong>Save</strong> before continuing.
        </>
      ),
    },

    { kind: "h", text: "2. Open a terminal on the sensor" },
    {
      kind: "p",
      text: (
        <>
          SSH in (or use the console). Everything below runs <strong>on the sensor</strong>,
          not your workstation. If a {C("docker")} command says{" "}
          <em>permission denied</em>, run it as the NetMon service account or prefix it
          with {C("sudo")}.
        </>
      ),
    },
    { kind: "code", code: "ssh <user>@<sensor-ip>", caption: "from your workstation" },

    { kind: "h", text: "3. Check what the box currently has" },
    {
      kind: "p",
      text: <>See the control-plane settings the collector is actually running with (secrets are masked):</>,
    },
    {
      kind: "code",
      code: `sudo docker exec netmon-collector printenv \\
  | grep -E 'NETMON_DASHBOARD_URL|NETMON_BOOTSTRAP_KEY|NETMON_ENROLL_TOKEN' \\
  | sed -E 's/(KEY=|TOKEN=).{4,}/\\1********/'`,
    },
    { kind: "p", text: <>Look for any of these three problems — fix whichever apply in Step 4:</> },
    {
      kind: "steps",
      items: [
        <>{C("NETMON_DASHBOARD_URL")} is blank → the box never calls home.</>,
        <>A leftover {C("NETMON_ENROLL_TOKEN=nms1_…")} is set → it overrides auto-enroll and the dashboard rejects it (HTTP 401).</>,
        <>{C("NETMON_BOOTSTRAP_KEY")} is blank → the box has no key to enroll with.</>,
      ],
    },

    { kind: "h", text: "4. Fix the config (command line — no text editor)" },
    {
      kind: "callout",
      tone: "warn",
      text: (
        <>
          Edit in place with {C("sed")} so the file keeps its owner and permissions.
          Do <strong>not</strong> use {C("cp")}, {C("install")}, or {C("chown")} on{" "}
          {C("/etc/netmon/netmon.env")} — changing its owner stops the collector from
          reading it.
        </>
      ),
    },
    { kind: "p", text: <>Set the dashboard URL:</> },
    {
      kind: "code",
      code: `sudo sed -i 's|^NETMON_DASHBOARD_URL=.*|NETMON_DASHBOARD_URL="https://netmon.sbcss.net"|' /etc/netmon/netmon.env`,
    },
    { kind: "p", text: <>Clear any stale manual token so auto-enrollment can take over:</> },
    {
      kind: "code",
      code: `sudo sed -i 's|^NETMON_ENROLL_TOKEN=.*|NETMON_ENROLL_TOKEN=""|' /etc/netmon/netmon.env`,
    },
    {
      kind: "p",
      text: (
        <>
          Set the bootstrap key — replace {C("<BOOTSTRAP_KEY>")} with the key you copied
          in Step 1:
        </>
      ),
    },
    {
      kind: "code",
      code: `sudo sed -i 's|^NETMON_BOOTSTRAP_KEY=.*|NETMON_BOOTSTRAP_KEY="<BOOTSTRAP_KEY>"|' /etc/netmon/netmon.env`,
    },
    {
      kind: "callout",
      tone: "info",
      text: (
        <>
          Tip: put a <strong>space</strong> before the command to keep the key out of your
          shell history (works when {C("HISTCONTROL")} includes {C("ignorespace")}).
        </>
      ),
    },

    { kind: "h", text: "5. Restart the collector and confirm" },
    {
      kind: "p",
      text: <>Recreate the collector so it loads the new settings (a plain restart won&apos;t re-read the file):</>,
    },
    { kind: "code", code: "cd ~/NetMon && sudo docker compose up -d --force-recreate collector" },
    { kind: "p", text: <>Trigger a check-in and watch it enroll:</> },
    { kind: "code", code: "sudo docker exec netmon-collector python -m collector checkin" },
    {
      kind: "p",
      text: (
        <>
          Success looks like:{" "}
          {C("auto-enrolled with dashboard; per-sensor token stored")}. You can also
          confirm with the operator console:
        </>
      ),
    },
    { kind: "code", code: "sudo ./netmon status" },
    {
      kind: "p",
      text: (
        <>
          Under <strong>Control plane / enrollment</strong>, {C("enrolled:")} should
          read <strong>yes</strong>.
        </>
      ),
    },

    { kind: "h", text: "6. Verify in the dashboard" },
    {
      kind: "p",
      text: (
        <>
          Open the sensor&apos;s page in the dashboard. <strong>Last check-in</strong>{" "}
          now shows a recent time and <strong>Reported config</strong> is populated —
          confirmation the box is talking to the control plane.
        </>
      ),
    },
    {
      kind: "image",
      src: "/help/sensor-enrolled.png",
      alt: "Sensor detail page showing a recent check-in time and reported config populated",
      caption: "After the fix: a recent check-in and reported config (a healthy sensor).",
    },

    { kind: "h", text: "Troubleshooting" },
    {
      kind: "steps",
      items: [
        <>{C("checkin skipped: NETMON_DASHBOARD_URL not set")} → the URL is still blank; redo the first command in Step 4.</>,
        <>{C("HTTP 401 on /api/sensor/checkin")} → a stale token is still set; redo the {C("NETMON_ENROLL_TOKEN")} command, then recreate (Step 5).</>,
        <>{C("auto-enroll failed (dashboard refused the bootstrap key…)")} → the key is wrong/blank or auto-enroll is off; re-copy the key (Step 1) and check the toggle.</>,
        <>{C("permission denied … docker.sock")} → run the {C("docker")} commands as the NetMon service account, or with {C("sudo")}.</>,
      ],
    },
    {
      kind: "callout",
      tone: "success",
      text: (
        <>
          Newer collector builds default the dashboard URL automatically and warn at
          startup when a box is half-configured, so this should get rarer over time.
        </>
      ),
    },
  ],
};

const fixSftpUpload: HelpArticle = {
  slug: "fix-automatic-sftp-upload",
  title: "Fix automatic SFTP upload (sensor shows up but no data)",
  summary:
    "A sensor enrolls and checks in fine, but no scans/devices ever appear. Usually the SFTP credentials are valid but uploads are switched OFF. Turn them on from the dashboard or on the box.",
  category: "Sensors",
  updated: "2026-06-11",
  blocks: [
    {
      kind: "callout",
      tone: "info",
      text: (
        <>
          <strong>Symptom:</strong> the sensor is listed and{" "}
          <strong>Last check-in</strong> is recent, but its school stays empty —
          no devices, no scans, no network map. On the box, {C("upload-test")}{" "}
          <em>passes</em> while {C("upload-now")} says{" "}
          <strong>&ldquo;SFTP disabled.&rdquo;</strong> The bundles are being
          built but never shipped, so nothing reaches the dashboard to ingest.
        </>
      ),
    },
    {
      kind: "p",
      text: (
        <>
          <strong>Why this happens.</strong> A sensor needs two things to upload:
          valid SFTP <em>credentials</em> AND the upload <em>switch</em> turned
          on ({C("NETMON_SFTP_ENABLED=true")}). The switch defaults to{" "}
          <strong>off</strong>. Boxes deployed before 2026-06-11 got working
          credentials but never had the switch flipped, so they sit there
          &ldquo;connected but silent.&rdquo; The confusing part:{" "}
          {C("upload-test")} only checks the credentials — it deliberately
          ignores the switch — so a green test does <em>not</em> mean uploads
          work.
        </>
      ),
    },
    {
      kind: "callout",
      tone: "warn",
      text: (
        <>
          A passing <strong>Test SFTP</strong> / {C("upload-test")} is{" "}
          <strong>not</strong> proof that data is flowing. The real check is{" "}
          {C("upload-now")} reporting {C("status: uploaded")} (not{" "}
          {C("saved_only")}), or the dashboard showing{" "}
          <strong>Reported config → SFTP uploads: enabled</strong> with bundles
          actually arriving.
        </>
      ),
    },

    { kind: "h", text: "Fix it from the dashboard (no SSH — preferred)" },
    {
      kind: "steps",
      items: [
        <>Open <strong>School &amp; district settings</strong> (left sidebar, under Monitoring) and pick the district at the top.</>,
        <>In the <strong>Per-sensor capabilities</strong> table, find the sensor&apos;s row and tick the <strong>SFTP upload</strong> box.</>,
        <>Click <strong>Save capabilities</strong>. (The destination host/user/path was already set at deployment — this just switches uploading on.)</>,
        <>The box applies it on its next check-in (every ~3 minutes) and recreates the collector so the new setting takes effect — no manual restart needed.</>,
      ],
    },
    {
      kind: "callout",
      tone: "info",
      text: (
        <>
          <strong>Many boxes at once?</strong> Use{" "}
          <strong>Sensors → SFTP rotation</strong> to push the same SFTP
          destination (with <em>Enable</em> checked) to every box, or tick the
          SFTP column for several rows in the capabilities table before saving.
          Both merge into each sensor&apos;s config and roll out on the next
          check-in.
        </>
      ),
    },

    { kind: "h", text: "Fix it on the box (if you have SSH)" },
    {
      kind: "code",
      caption: "Flip the switch in the env file, then recreate the collector so it reloads the env.",
      code: [
        "sudo sed -i 's/^NETMON_SFTP_ENABLED=.*/NETMON_SFTP_ENABLED=true/' /etc/netmon/netmon.env",
        "# (if the line is missing entirely, add it:)",
        "grep -q '^NETMON_SFTP_ENABLED=' /etc/netmon/netmon.env || echo 'NETMON_SFTP_ENABLED=true' | sudo tee -a /etc/netmon/netmon.env",
        "",
        "# compose only injects the env file at container-CREATE, so recreate (not restart):",
        "cd /opt/netmon && docker compose up -d --force-recreate collector",
      ].join("\n"),
    },
    {
      kind: "callout",
      tone: "warn",
      text: (
        <>
          Use {C("--force-recreate")}, not {C("docker compose restart")}. A plain
          restart reuses the old container and the rewritten env file is{" "}
          <strong>not</strong> picked up — the box would stay disabled.
        </>
      ),
    },

    { kind: "h", text: "Verify it's actually uploading" },
    {
      kind: "steps",
      items: [
        <>On the sensor page, click <strong>Test SFTP</strong> (Remote console → Queued diagnostics). On the next check-in the result should read <strong>uploads: ENABLED</strong>.</>,
        <>Click <strong>Force upload</strong> (Commands). The result status should be {C("uploaded")} — not {C("saved_only")}.</>,
        <>Within a few minutes the school fills in with devices/scans, and the sensor&apos;s <strong>Reported config</strong> shows <strong>SFTP uploads: enabled</strong>.</>,
        <>From the box, the one-shot check is: {C("docker compose exec collector python -m collector upload-test")} — it now prints whether uploads are enabled.</>,
      ],
    },

    { kind: "h", text: "Troubleshooting" },
    {
      kind: "steps",
      items: [
        <>{C("upload-now")} says {C("saved_only")} → the switch is still off; the env edit didn&apos;t land or the collector wasn&apos;t recreated. Redo the fix and {C("--force-recreate")}.</>,
        <>{C("upload-test")} FAILS (not just disabled) → it&apos;s a credentials/reachability problem, not the switch. Recheck host/port/user/password and that the box can reach the SFTP host on port 22.</>,
        <>Test passes + uploads enabled, but the dashboard still looks empty → the bundles are arriving but ingestion hasn&apos;t run or is pointed elsewhere. Check <strong>Settings → SFTP ingestion</strong>.</>,
        <>An overnight auto-update did <em>not</em> fix it → correct: auto-update only refreshes the container code, it never re-runs the installer or rewrites a box&apos;s env. Each affected box must be remediated as above.</>,
      ],
    },
    {
      kind: "callout",
      tone: "success",
      text: (
        <>
          New deployments now set {C("NETMON_SFTP_ENABLED=true")} automatically,
          so freshly installed sensors upload out of the box — this fix is only
          for boxes deployed before that change.
        </>
      ),
    },
  ],
};

export const HELP_ARTICLES: HelpArticle[] = [fixEnrollment, fixSftpUpload];

export function getArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}
