import {
  useState,
  useEffect,
  NavigationStack,
  List,
  Section,
  TextField,
  SecureField,
  Button,
  Text,
  VStack,
  Navigation,
  Script,
  Widget,
} from "scripting";
import {
  fetchQuotaData,
  normalizeCpaBaseUrl,
  KEY,
  pctLabel,
  getKeychain,
  getStorage,
} from "./api";
import { UI } from "./theme";

function ConfigApp() {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("");
  const [quotaSummary, setQuotaSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      // https://scriptingapp.github.io/guide/Device%20Capabilities/Keychain
      // https://scriptingapp.github.io/guide/Utilities/Storage
      const keychain = getKeychain();
      const storage = getStorage();
      const storedBase = keychain?.get(KEY.cpaBase) || storage?.get(KEY.cpaBase) || "";
      const storedKey = keychain?.get(KEY.cpaKey) || storage?.get(KEY.cpaKey) || "";
      if (storedBase) setBaseUrl(storedBase);
      if (storedKey) setApiKey(storedKey);
    } catch (_) {}
  }, []);

  const saveConfig = () => {
    try {
      const cleanUrl = normalizeCpaBaseUrl(baseUrl);
      const cleanKey = apiKey.trim();
      const keychain = getKeychain();
      const storage = getStorage();
      if (!keychain?.set || !storage?.set) {
        setStatus("当前环境没有 Keychain / Storage");
        return false;
      }
      const keyOk = keychain.set(KEY.cpaBase, cleanUrl) && keychain.set(KEY.cpaKey, cleanKey);
      const storeOk = storage.set(KEY.cpaBase, cleanUrl) && storage.set(KEY.cpaKey, cleanKey);
      if (!keyOk || !storeOk) {
        setStatus("保存失败");
        return false;
      }
      setStatus("配置已保存");
      return true;
    } catch (e: any) {
      setStatus(`保存失败: ${e.message || e}`);
      return false;
    }
  };

  const handleFetchQuota = async () => {
    if (!saveConfig()) return;
    setLoading(true);
    setStatus("正在从 CPA 抓取最新配额数据...");
    setQuotaSummary(null);
    try {
      const data = await fetchQuotaData(true);
      const lines = [
        `• Grok: ${data.grok.remainingPct != null ? pctLabel(data.grok.remainingPct) + "%" : "未获取"} (${data.grok.resetHint || data.grok.windowLabel})`,
        `• ChatGPT: ${data.chatgpt.remainingPct != null ? pctLabel(data.chatgpt.remainingPct) + "%" : "未获取"} (${data.chatgpt.resetHint || data.chatgpt.windowLabel})`,
        `• Gemini: ${data.gemini.remainingPct != null ? pctLabel(data.gemini.remainingPct) + "%" : "未获取"} (${data.gemini.resetHint || data.gemini.windowLabel})`,
      ];
      if (data.errors && data.errors.length > 0) {
        lines.push(`\n提示/警告: ${data.errors.join("; ")}`);
      }
      setQuotaSummary(lines.join("\n"));
      setStatus("获取配额成功！");
      Widget.reloadAll();
    } catch (e: any) {
      setStatus(`获取失败: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async (family: "systemSmall" | "systemMedium" | "systemLarge") => {
    try {
      await Widget.preview({ family });
    } catch (e: any) {
      setStatus(`小组件预览失败: ${e.message || e}`);
    }
  };

  return (
    <NavigationStack>
      <List navigationTitle="AI Quota 设置">
        <Section
          header={<Text>CPA 管理端连接</Text>}
          footer={<Text>SuperGrok、ChatGPT 与 Google 认证均从 CLI Proxy API (CPA) 获取，安全保存在系统 Keychain 中。</Text>}
        >
          <TextField
            title="CPA Base URL"
            prompt="https://host:port"
            value={baseUrl}
            onChanged={setBaseUrl}
          />
          <SecureField
            title="CPA API Key"
            prompt="管理端 API Key"
            value={apiKey}
            onChanged={setApiKey}
          />
          <Button title="保存凭据" action={saveConfig} />
        </Section>

        <Section header={<Text>连接测试与配额拉取</Text>}>
          <Button
            title={loading ? "正在拉取..." : "测试连接并拉取配额"}
            action={handleFetchQuota}
            disabled={loading}
          />
          {status ? (
            <Text font={13} foregroundStyle={UI.muted}>
              {status}
            </Text>
          ) : null}
          {quotaSummary ? (
            <VStack alignment="leading" spacing={4} padding={{ vertical: 4 }}>
              <Text font={13} fontWeight="semibold">实时配额情况：</Text>
              <Text font={12} foregroundStyle={UI.muted}>
                {quotaSummary}
              </Text>
            </VStack>
          ) : null}
        </Section>

        <Section header={<Text>小组件预览</Text>}>
          <Button
            title="预览小号组件 (systemSmall)"
            action={() => handlePreview("systemSmall")}
          />
          <Button
            title="预览中号组件 (systemMedium)"
            action={() => handlePreview("systemMedium")}
          />
          <Button
            title="预览大号组件 (systemLarge)"
            action={() => handlePreview("systemLarge")}
          />
        </Section>
      </List>
    </NavigationStack>
  );
}

async function run() {
  await Navigation.present({
    element: <ConfigApp />,
  });
  Script.exit();
}

run();
