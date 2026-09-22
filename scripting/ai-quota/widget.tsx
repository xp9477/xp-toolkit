import {
  Widget,
  VStack,
  HStack,
  ZStack,
  Text,
  Image,
  Link,
  Button,
  Capsule,
  Spacer,
  Divider,
  DateLabel,
  GeometryReader,
} from "scripting";
import type { QuotaData, ServiceQuota, ServiceAccountDetail } from "./types";
import { UI, accentFor, accentFor5h, shortenHint, type DynamicShapeStyle } from "./theme";
import { fetchQuotaData, pctLabel } from "./api";
import { ReloadQuotaIntent } from "./app_intents";

function ProgressBar({
  pct,
  color,
  height = 4,
}: {
  pct: number | null;
  color: DynamicShapeStyle;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct ?? 0)) / 100;
  return (
    <VStack frame={{ height }}>
      <GeometryReader>
        {(proxy) => {
          const totalW = proxy.size.width;
          const fillW = Math.max(height, totalW * clamped);
          return (
            <ZStack alignment="leading">
              <Capsule fill={UI.track} frame={{ width: totalW, height }} />
              {clamped > 0 ? (
                <Capsule
                  fill={color}
                  frame={{ width: fillW, height }}
                  widgetAccentable
                />
              ) : null}
            </ZStack>
          );
        }}
      </GeometryReader>
    </VStack>
  );
}

function FreshnessBadge({ isCached }: { isCached?: boolean }) {
  return (
    <HStack spacing={3} alignment="center">
      <Text
        font={8}
        foregroundStyle={isCached ? "systemOrange" : "systemGreen"}
      >
        ●
      </Text>
      <Text font={9} foregroundStyle={UI.muted}>
        {isCached ? "缓存" : "在线"}
      </Text>
    </HStack>
  );
}

function ServiceColumn({ service }: { service: ServiceQuota }) {
  const remainingText = pctLabel(service.remainingPct);
  const countNotice =
    service.accountCount && service.accountCount > 1
      ? ` (${service.accountCount}账号)`
      : null;
  const resetText = service.resetHint ? shortenHint(service.resetHint) : service.windowLabel;

  return (
    <Link url={service.url}>
      <VStack alignment="leading" spacing={4}>
        <HStack alignment="center">
          <Text font={12} fontWeight="semibold" foregroundStyle={UI.ink}>
            {service.name}
          </Text>
          {countNotice ? (
            <Text font={8} foregroundStyle={UI.faint}>
              {countNotice}
            </Text>
          ) : null}
          <Spacer />
          {service.plan ? (
            <Text font={9} foregroundStyle={UI.muted}>
              {service.plan}
            </Text>
          ) : null}
        </HStack>

        <HStack alignment="firstTextBaseline" spacing={2}>
          <Text
            font={24}
            fontWeight="bold"
            foregroundStyle={accentFor(service.remainingPct)}
            widgetAccentable
          >
            {remainingText}
          </Text>
          <Text font={11} fontWeight="semibold" foregroundStyle={UI.muted}>
            %
          </Text>
          <Spacer />
          <Text font={9} foregroundStyle={UI.muted}>
            {resetText}
          </Text>
        </HStack>

        <ProgressBar
          pct={service.remainingPct}
          color={accentFor(service.remainingPct)}
          height={5}
        />

        {service.remaining5hPct != null ? (
          <VStack alignment="leading" spacing={2} padding={{ top: 2 }}>
            <HStack alignment="center">
              <Text font={8} foregroundStyle={UI.muted}>
                5h 窗口
              </Text>
              <Spacer />
              <Text
                font={9}
                fontWeight="semibold"
                foregroundStyle={accentFor5h(service.remaining5hPct)}
                widgetAccentable
              >
                {pctLabel(service.remaining5hPct)}%
              </Text>
              {service.reset5hHint ? (
                <Text font={8} foregroundStyle={UI.faint}>
                  ({shortenHint(service.reset5hHint)})
                </Text>
              ) : null}
            </HStack>
            <ProgressBar
              pct={service.remaining5hPct}
              color={accentFor5h(service.remaining5hPct)}
              height={3}
            />
          </VStack>
        ) : null}
      </VStack>
    </Link>
  );
}

function SmallServiceRow({ service }: { service: ServiceQuota }) {
  const resetText = service.resetHint ? shortenHint(service.resetHint) : service.windowLabel;
  return (
    <Link url={service.url}>
      <VStack alignment="leading" spacing={2}>
        <HStack alignment="center">
          <Text font={11} fontWeight="semibold" foregroundStyle={UI.ink}>
            {service.name}
          </Text>
          <Spacer />
          <Text
            font={12}
            fontWeight="bold"
            foregroundStyle={accentFor(service.remainingPct)}
            widgetAccentable
          >
            {pctLabel(service.remainingPct)}%
          </Text>
        </HStack>
        <ProgressBar
          pct={service.remainingPct}
          color={accentFor(service.remainingPct)}
          height={4}
        />
        <HStack alignment="center">
          <Text font={9} foregroundStyle={UI.muted}>
            {resetText}
          </Text>
          <Spacer />
          {service.remaining5hPct != null ? (
            <Text font={8} foregroundStyle={accentFor5h(service.remaining5hPct)}>
              5h:{pctLabel(service.remaining5hPct)}%
            </Text>
          ) : null}
        </HStack>
      </VStack>
    </Link>
  );
}

function AccountRow({
  detail,
  serviceName,
}: {
  detail: ServiceAccountDetail;
  serviceName: string;
}) {
  return (
    <HStack alignment="center" spacing={6}>
      <Text font={10} fontWeight="bold" foregroundStyle={UI.ink}>
        {serviceName}
      </Text>
      <Text font={10} foregroundStyle={UI.muted} lineLimit={1}>
        {detail.name}
      </Text>
      <Spacer />
      <Text font={9} fontWeight="semibold" foregroundStyle={accentFor(detail.remainingPct)}>
        {pctLabel(detail.remainingPct)}%
      </Text>
      {detail.resetHint ? (
        <Text font={8} foregroundStyle={UI.faint}>
          ({shortenHint(detail.resetHint)})
        </Text>
      ) : null}
      {detail.remaining5hPct != null ? (
        <Text font={8} foregroundStyle={accentFor5h(detail.remaining5hPct)}>
          5h:{pctLabel(detail.remaining5hPct)}%
        </Text>
      ) : null}
    </HStack>
  );
}

export function QuotaWidget({ data }: { data: QuotaData }) {
  const f = Widget.family;

  if (f === "accessoryInline") {
    return (
      <Text font={10}>
        Grok:{pctLabel(data.grok.remainingPct)}% · GPT:{pctLabel(data.chatgpt.remainingPct)}% · Gem:{pctLabel(data.gemini.remainingPct)}%
      </Text>
    );
  }

  if (f === "accessoryRectangular") {
    return (
      <VStack alignment="leading" spacing={3} padding={4}>
        <HStack alignment="center">
          <Text font={10} fontWeight="bold" foregroundStyle={UI.ink}>
            AI Quota
          </Text>
          <Spacer />
          <DateLabel
            date={new Date(data.fetchedAt)}
            style="relative"
            font={8}
            foregroundStyle={UI.muted}
          />
        </HStack>
        <HStack spacing={8} alignment="center">
          <VStack alignment="center" spacing={1}>
            <Text font={8} foregroundStyle={UI.muted}>
              Grok
            </Text>
            <Text font={12} fontWeight="bold" foregroundStyle={accentFor(data.grok.remainingPct)}>
              {pctLabel(data.grok.remainingPct)}%
            </Text>
          </VStack>
          <Divider />
          <VStack alignment="center" spacing={1}>
            <Text font={8} foregroundStyle={UI.muted}>
              GPT
            </Text>
            <Text font={12} fontWeight="bold" foregroundStyle={accentFor(data.chatgpt.remainingPct)}>
              {pctLabel(data.chatgpt.remainingPct)}%
            </Text>
          </VStack>
          <Divider />
          <VStack alignment="center" spacing={1}>
            <Text font={8} foregroundStyle={UI.muted}>
              Gemini
            </Text>
            <Text font={12} fontWeight="bold" foregroundStyle={accentFor(data.gemini.remainingPct)}>
              {pctLabel(data.gemini.remainingPct)}%
            </Text>
          </VStack>
        </HStack>
      </VStack>
    );
  }

  if (f === "systemSmall") {
    return (
      <VStack
        alignment="leading"
        spacing={6}
        padding={12}
        widgetBackground="systemBackground"
      >
        <HStack alignment="center">
          <Text font={11} fontWeight="bold" foregroundStyle={UI.ink}>
            AI Quota
          </Text>
          <Spacer />
          <FreshnessBadge isCached={data.isCached} />
          <DateLabel
            date={new Date(data.fetchedAt)}
            style="relative"
            font={8}
            foregroundStyle={UI.muted}
          />
          <Button intent={ReloadQuotaIntent(undefined)} buttonStyle="plain">
            <Image
              systemName="arrow.clockwise"
              imageScale="small"
              foregroundStyle={UI.muted}
            />
          </Button>
        </HStack>

        <SmallServiceRow service={data.grok} />
        <Divider />
        <SmallServiceRow service={data.chatgpt} />
        <Divider />
        <SmallServiceRow service={data.gemini} />
      </VStack>
    );
  }

  if (f === "systemLarge") {
    const allDetails: { detail: ServiceAccountDetail; serviceName: string }[] = [];
    if (data.grok.accountDetails) {
      data.grok.accountDetails.forEach((d) => allDetails.push({ detail: d, serviceName: "Grok" }));
    }
    if (data.chatgpt.accountDetails) {
      data.chatgpt.accountDetails.forEach((d) => allDetails.push({ detail: d, serviceName: "ChatGPT" }));
    }
    if (data.gemini.accountDetails) {
      data.gemini.accountDetails.forEach((d) => allDetails.push({ detail: d, serviceName: "Gemini" }));
    }

    return (
      <VStack
        alignment="leading"
        spacing={10}
        padding={16}
        widgetBackground="systemBackground"
      >
        {/* Top bar */}
        <HStack alignment="center">
          <HStack spacing={6} alignment="center">
            <Text font={14} fontWeight="bold" foregroundStyle={UI.ink}>
              AI Quota
            </Text>
            <FreshnessBadge isCached={data.isCached} />
            <DateLabel
              date={new Date(data.fetchedAt)}
              style="relative"
              font={10}
              foregroundStyle={UI.muted}
            />
          </HStack>
          <Spacer />
          <Button intent={ReloadQuotaIntent(undefined)} buttonStyle="plain">
            <Image
              systemName="arrow.clockwise"
              imageScale="small"
              foregroundStyle={UI.muted}
            />
          </Button>
        </HStack>

        {/* 3 Main Columns */}
        <HStack spacing={12} alignment="top">
          <ServiceColumn service={data.grok} />
          <Divider />
          <ServiceColumn service={data.chatgpt} />
          <Divider />
          <ServiceColumn service={data.gemini} />
        </HStack>

        <Divider />

        {/* Detailed accounts */}
        <VStack alignment="leading" spacing={4}>
          <Text font={11} fontWeight="semibold" foregroundStyle={UI.muted}>
            多账号明细
          </Text>
          {allDetails.length > 0 ? (
            allDetails.slice(0, 5).map((item, idx) => (
              <AccountRow key={idx} detail={item.detail} serviceName={item.serviceName} />
            ))
          ) : (
            <Text font={10} foregroundStyle={UI.faint}>
              暂无更多子账号数据
            </Text>
          )}
        </VStack>
      </VStack>
    );
  }

  // Default: systemMedium
  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={14}
      widgetBackground="systemBackground"
    >
      <HStack alignment="center">
        <HStack spacing={6} alignment="center">
          <Text font={13} fontWeight="bold" foregroundStyle={UI.ink}>
            AI Quota
          </Text>
          <FreshnessBadge isCached={data.isCached} />
          <DateLabel
            date={new Date(data.fetchedAt)}
            style="relative"
            font={10}
            foregroundStyle={UI.muted}
          />
        </HStack>
        <Spacer />
        <Button intent={ReloadQuotaIntent(undefined)} buttonStyle="plain">
          <Image
            systemName="arrow.clockwise"
            imageScale="small"
            foregroundStyle={UI.muted}
          />
        </Button>
      </HStack>

      <HStack spacing={12} alignment="top">
        <ServiceColumn service={data.grok} />
        <Divider />
        <ServiceColumn service={data.chatgpt} />
        <Divider />
        <ServiceColumn service={data.gemini} />
      </HStack>
    </VStack>
  );
}

// Widget lifecycle
(async () => {
  try {
    const data = await fetchQuotaData();
    Widget.present(<QuotaWidget data={data} />, {
      policy: "after",
      date: new Date(Date.now() + 15 * 60 * 1000),
    });
  } catch (e: any) {
    Widget.present(
      <VStack alignment="center" spacing={4} padding={14} widgetBackground="systemBackground">
        <Text font={12} fontWeight="bold" foregroundStyle="systemRed">
          AI Quota 加载失败
        </Text>
        <Text font={10} foregroundStyle={UI.muted} lineLimit={2}>
          {String(e?.message || e)}
        </Text>
      </VStack>
    );
  }
})();
