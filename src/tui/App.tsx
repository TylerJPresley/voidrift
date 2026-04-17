import React from "react";
import { Box, Text } from "ink";
import type { HeaderRegion } from "./regions/HeaderRegion.js";
import type { ContentRegion } from "./regions/ContentRegion.js";
import type { FooterRegion } from "./regions/FooterRegion.js";
import type { InputRegion } from "./regions/InputRegion.js";
import { HeaderView } from "./components/HeaderView.js";
import { ContentView } from "./components/ContentView.js";
import { FooterView } from "./components/FooterView.js";
import { InputView } from "./components/InputView.js";

export interface AppProps {
  header: HeaderRegion;
  content: ContentRegion;
  footer: FooterRegion;
  input: InputRegion;
  onSubmit: (text: string) => void;
  onEscape: () => void;
}

export function App({ header, content, footer, input, onSubmit, onEscape }: AppProps) {
  return (
    <Box flexDirection="column" height="100%">
      {/* Conversation area */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        <HeaderView region={header} />
        <ContentView region={content} />
      </Box>

      {/* Separator */}
      <Text dimColor>{"─".repeat(process.stdout.columns || 80)}</Text>

      {/* Footer */}
      <FooterView region={footer} />

      {/* Spacer */}
      <Text> </Text>

      {/* Input */}
      <InputView input={input} footer={footer} onSubmit={onSubmit} onEscape={onEscape} />
    </Box>
  );
}
