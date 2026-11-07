import type { ComponentProps } from "react";
import {
  outboundUrl,
  OUTBOUND_LINK_ATTRIBUTES,
} from "../lib/domain/outbound-links.ts";

export default function ExternalLink({ href, ...props }: ComponentProps<"a">) {
  return (
    <a
      {...props}
      {...OUTBOUND_LINK_ATTRIBUTES}
      href={href === undefined ? undefined : outboundUrl(href)}
    />
  );
}
