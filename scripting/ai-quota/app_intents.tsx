import { AppIntentManager, AppIntentProtocol, Widget } from "scripting";
import { fetchQuotaData, setRefreshing } from "./api";

export const ReloadQuotaIntent = AppIntentManager.register({
  name: "ReloadQuotaIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
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
