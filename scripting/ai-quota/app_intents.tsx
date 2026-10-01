import { AppIntentManager, AppIntentProtocol, Widget } from "scripting";
import { fetchQuotaData, setRefreshing } from "./api";

export const ReloadQuotaIntent = AppIntentManager.register({
  name: "ReloadQuotaIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    // The first reload paints the static "正在刷新" snapshot. widget.tsx
    // skips the network while this flag is set, then the second reload
    // swaps in the quota this fetch just wrote.
    setRefreshing(true);
    Widget.reloadAll();
    try {
      await fetchQuotaData(true);
    } catch (e) {
      console.error("ReloadQuotaIntent fetchQuotaData failed", e);
    } finally {
      setRefreshing(false);
      Widget.reloadAll();
    }
  },
});
