/**
 * React-обвязка над BiofeedbackBus: Provider + hooks для подписки.
 *
 * Использование:
 *
 *   <BiofeedbackBusProvider>
 *     <App />
 *   </BiofeedbackBusProvider>
 *
 *   const bpm = useBiofeedbackChannel("pulseBpm");
 *   useBiofeedbackSubscribe("beat", (e) => playGong());
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import { BiofeedbackBus } from "@/modules/biofeedback/bus/biofeedback-bus";
import type {
  ChannelEvent,
  ChannelListener,
  ChannelName,
} from "@/modules/biofeedback/bus/channels";

const BusContext = createContext<BiofeedbackBus | null>(null);

export function BiofeedbackBusProvider({
  children,
  bus,
}: PropsWithChildren<{ bus?: BiofeedbackBus }>) {
  const value = useMemo(() => bus ?? new BiofeedbackBus(), [bus]);
  return <BusContext.Provider value={value}>{children}</BusContext.Provider>;
}

export function useBiofeedbackBus(): BiofeedbackBus {
  const ctx = useContext(BusContext);
  if (ctx == null) {
    throw new Error(
      "useBiofeedbackBus(): нет BiofeedbackBusProvider выше по дереву.",
    );
  }
  return ctx;
}

/**
 * Подписка на канал. Перерисовывает компонент при каждом новом событии.
 * Если в канале уже есть последнее событие (`getLast`) — оно используется как стартовое.
 */
export function useBiofeedbackChannel<K extends ChannelName>(
  channel: K,
): ChannelEvent<K> | undefined {
  const bus = useBiofeedbackBus();
  const [value, setValue] = useState<ChannelEvent<K> | undefined>(() =>
    bus.getLast(channel),
  );

  useEffect(() => {
    setValue(bus.getLast(channel));
    return bus.subscribe(channel, (event) => {
      setValue(event);
    });
  }, [bus, channel]);

  return value;
}

/**
 * Подписка для побочных эффектов (звук, аналитика). Не вызывает re-render.
 * `listener` обновляется через ref — нет нужды стабилизировать его в useCallback.
 */
export function useBiofeedbackSubscribe<K extends ChannelName>(
  channel: K,
  listener: ChannelListener<K>,
): void {
  const bus = useBiofeedbackBus();
  const ref = useRef<ChannelListener<K>>(listener);
  ref.current = listener;

  useEffect(() => {
    return bus.subscribe(channel, (event) => {
      ref.current(event);
    });
  }, [bus, channel]);
}

/** Обёртка для публикации (для случаев, когда нужно опубликовать из React-кода). */
export function useBiofeedbackPublish() {
  const bus = useBiofeedbackBus();
  return useCallback(
    <K extends ChannelName>(channel: K, event: ChannelEvent<K>) => {
      bus.publish(channel, event);
    },
    [bus],
  );
}
