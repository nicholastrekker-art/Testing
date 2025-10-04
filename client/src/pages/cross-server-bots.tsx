import MasterControlPanel from "@/components/master-control-panel";
import { useState } from "react";

export default function CrossServerBots() {
  const [open] = useState(true);
  
  return <MasterControlPanel open={open} onClose={() => {}} />;
}
