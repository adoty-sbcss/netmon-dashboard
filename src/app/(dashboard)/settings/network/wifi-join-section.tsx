import {
  listSchoolsForDistrict,
  listWifiProfilesForSchool,
  listSchoolWifiRadios,
  listWifiForSchool,
} from "@/db/queries";
import { WifiConfigPortal } from "@/components/wifi-config-portal";

/**
 * WIFI-6: Wi-Fi join configuration on the district settings page (moved here from the
 * per-school Wireless tab, which is now monitoring-only). The portal is school-scoped,
 * so render one per Wi-Fi-CAPABLE school in the district — a school with a sensor
 * radio, or with profiles already configured. `basePath` is the settings path so a
 * config change revalidates this page. Renders nothing if no school can do Wi-Fi join.
 */
export async function DistrictWifiJoinSection({ districtId }: { districtId: number }) {
  const schools = await listSchoolsForDistrict(districtId);
  const perSchool = await Promise.all(
    schools.map(async (s) => {
      const [profiles, radios, survey] = await Promise.all([
        listWifiProfilesForSchool(s.id),
        listSchoolWifiRadios(s.id),
        listWifiForSchool(s.id),
      ]);
      const surveySsids = Array.from(
        new Set(survey.bss.map((b) => b.ssid).filter((x): x is string => !!x)),
      ).sort();
      return { school: s, profiles, radios, surveySsids };
    }),
  );
  const relevant = perSchool.filter((p) => p.radios.length > 0 || p.profiles.length > 0);
  if (relevant.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {relevant.map((p) => (
        <WifiConfigPortal
          key={p.school.id}
          schoolId={p.school.id}
          basePath="/settings/network"
          profiles={p.profiles}
          radios={p.radios}
          surveySsids={p.surveySsids}
          schoolLabel={p.school.name || p.school.slug}
        />
      ))}
    </div>
  );
}
