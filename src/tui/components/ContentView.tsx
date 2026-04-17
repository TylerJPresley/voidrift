import React from "react";
import { Box, Text } from "ink";
import type { ContentRegion } from "../regions/ContentRegion.js";
import { useRegion } from "../useRegion.js";
import { Message } from "../Message.js";
import { Thinking } from "../Thinking.js";

export function ContentView({ region }: { region: ContentRegion }) {
  useRegion(region);
  return (
    <>
      {region.messages.map((msg, i) => (
        <Message key={i} msg={msg} />
      ))}
      {region.thinking && <Thinking label={region.thinkingLabel} />}
      <Text> </Text>
    </>
  );
}
