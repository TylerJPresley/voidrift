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
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text color="#c678dd">{HEADER_ART}</Text>
      <Text> </Text>
      <Text dimColor>  Model <Text color="#4ec9b0" bold>{region.modelName}</Text>  ·  <Text color="#5c8cc8">/help</Text> for commands{region.hasMessages ? "  ·  /clear to start fresh" : ""}</Text>
      <Text> </Text>
    </Box>
  );
}
