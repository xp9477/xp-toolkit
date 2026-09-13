import { type PluginWorkspacePanelProps, useWorkspace } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { isFormattedTitle, parseFormattedTitle } from "./src/formatter";

export function WorkspaceTitleOverview({
  theme,
  layout,
  workspaceId,
}: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, (w) => ({
    id: w.id,
    name: w.name,
    title: w.title,
    directory: w.directory,
  }));

  const currentTitle = workspace?.title ?? workspace?.name ?? "";
  const isCompliant = isFormattedTitle(currentTitle);
  const parsed = parseFormattedTitle(currentTitle);

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        gap: layout.compact ? 12 : 16,
        backgroundColor: theme.colors.surface0,
      },
      header: {
        fontSize: layout.compact ? 18 : 22,
        fontWeight: "600" as const,
        color: theme.colors.foreground,
      },
      card: {
        backgroundColor: theme.colors.surface1,
        borderRadius: 8,
        padding: 16,
        gap: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      label: {
        fontSize: 12,
        color: theme.colors.foregroundMuted,
        textTransform: "uppercase" as const,
        letterSpacing: 0.5,
      },
      value: {
        fontSize: 15,
        color: theme.colors.foreground,
        fontWeight: "500" as const,
      },
      badge: {
        alignSelf: "flex-start" as const,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        backgroundColor: isCompliant
          ? theme.colors.statusSuccess + "20"
          : theme.colors.statusWarning + "20",
      },
      badgeText: {
        fontSize: 12,
        fontWeight: "600" as const,
        color: isCompliant
          ? theme.colors.statusSuccess
          : theme.colors.statusWarning,
      },
      detailRow: {
        flexDirection: "row" as const,
        gap: 16,
        marginTop: 4,
      },
      detailItem: {
        flex: 1,
      },
    }),
    [theme, layout.compact, isCompliant]
  );

  return (
    <View style={styles.screen}>
      <Text style={styles.header}>工作区标题规范监控</Text>

      <View style={styles.card}>
        <Text style={styles.label}>当前标题</Text>
        <Text style={styles.value}>{currentTitle || "（未设置）"}</Text>

        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {isCompliant ? "符合全局规范 (MMDD | 类型 | 主题)" : "待规范化或自定义"}
          </Text>
        </View>

        {parsed && (
          <View style={styles.detailRow}>
            <View style={styles.detailItem}>
              <Text style={styles.label}>日期</Text>
              <Text style={styles.value}>{parsed.mmdd}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.label}>类型</Text>
              <Text style={styles.value}>{parsed.type}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.label}>主题</Text>
              <Text style={styles.value}>{parsed.topic}</Text>
            </View>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>插件运行状态</Text>
        <Text style={styles.value}>守护进程持续自动监控中</Text>
        <Text style={{ fontSize: 13, color: theme.colors.foregroundMuted }}>
          新工作区和主任务将按真实创建时间（Asia/Shanghai）自动重命名为 MMDD | 类型 | 主题 格式。
        </Text>
      </View>
    </View>
  );
}
