import { DesignSystemShowcase } from "@/dev/design-system-showcase";
import { FIXTURE_CARDS } from "@/dev/fixtures";

export const metadata = { title: "Design system" };

export default function DesignSystemPage() {
  return <DesignSystemShowcase cards={FIXTURE_CARDS} />;
}
