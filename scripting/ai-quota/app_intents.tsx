import { AppIntentManager, AppIntentProtocol, Widget } from "scripting";
import { fetchQuotaData } from "./api";

export const ReloadQuotaIntent = AppIntentManager.register({
  name: "ReloadQuotaIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    try {
      await fetchQuotaData(true);
    } catch (e) {
      console.error("ReloadQuotaIntent fetchQuotaData failed", e);
    }
    await Widget.reloadAll();
  },
});
