import MasterControlPanel from "@/components/master-control-panel";

export default function MasterControl() {
  return (
    <div className="h-full w-full overflow-auto">
      <div className="p-6 max-w-full">
        <MasterControlPanel />
      </div>
    </div>
  );
}
