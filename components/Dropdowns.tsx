"use client";

import { useEffect } from "react";
import { mountDropdowns } from "../lib/client/dropdowns";

export default function Dropdowns() {
  useEffect(mountDropdowns, []);
  return null;
}
