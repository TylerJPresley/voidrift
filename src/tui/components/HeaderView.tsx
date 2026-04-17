import React from "react";
import { Text, Box } from "ink";
import type { HeaderRegion } from "../regions/HeaderRegion.js";
import { useRegion } from "../useRegion.js";

const HEADER_ART = `  ██╗   ██╗ ██████╗ ██╗██████╗ ██████╗ ██╗███████╗████████╗
  ██║   ██║██╔═══██╗██║██╔══██╗██╔══██╗██║██╔════╝╚══██╔══╝
  ██║   ██║██║   ██║██║██║  ██║██████╔╝██║█████╗     ██║   
  ╚██╗ ██╔╝██║   ██║██║██║  ██║██╔══██╗██║██╔══╝     ██║   
   ╚████╔╝ ╚██████╔╝██║██████╔╝██║  ██║██║██║        ██║   
    ╚═══╝   ╚═════╝ ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   `;

export function HeaderView({ region }: { region: HeaderRegion }) {
  useRegion(region);
  if (region.interacted) return null;
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text color="#c678dd">{HEADER_ART}</Text>
      <Text dimColor italic>  Agentic Software Engineering Framework</Text>
      <Text> </Text>
      <Box flexDirection="column" borderStyle="round" borderColor="#5a6aa8" paddingX={1}>
        <Text> </Text>
        <Text>  Welcome to <Text color="#c678dd" bold>VoidRift!</Text></Text>
        <Text> </Text>
        <Text dimColor>  Describe a task or ask a question to get started.</Text>
        <Text dimColor>  Type <Text color="#5c8cc8">/help</Text> for commands.</Text>
        {region.hasMessages && <Text dimColor>  Resuming previous conversation. /clear to start fresh.</Text>}
        <Text> </Text>
      </Box>
      <Text> </Text>
    </Box>
  );
}
