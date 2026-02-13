import { HandDisplayDemo } from "@/components/hand-display-demo";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hand Display Demo - Planar Nexus",
  description: "Interactive demonstration of the hand display system",
};

export default function HandDisplayDemoPage() {
  return <HandDisplayDemo />;
}
