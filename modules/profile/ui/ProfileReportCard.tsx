import type { ReactNode } from "react";

import { SectionHeader } from "@/modules/ui/ScreenSection";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";

export function ProfileReportCard(props: {
  title: string;
  subtitle?: string;
  periodSelector?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <SurfaceCardView>
      <SectionHeader title={props.title} subtitle={props.subtitle} />
      {props.periodSelector}
      {props.children}
      {props.footer}
    </SurfaceCardView>
  );
}
