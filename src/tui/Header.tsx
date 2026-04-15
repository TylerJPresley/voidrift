import React from "react";
import { Text, Box } from "ink";

const HEADER_ART = `  ██╗   ██╗ ██████╗ ██╗██████╗ ██████╗ ██╗███████╗████████╗
  ██║   ██║██╔═══██╗██║██╔══██╗██╔══██╗██║██╔════╝╚══██╔══╝
  ██║   ██║██║   ██║██║██║  ██║██████╔╝██║█████╗     ██║   
  ╚██╗ ██╔╝██║   ██║██║██║  ██║██╔══██╗██║██╔══╝     ██║   
   ╚████╔╝ ╚██████╔╝██║██████╔╝██║  ██║██║██║        ██║   
    ╚═══╝   ╚═════╝ ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   `;

interface HeaderProps {
  modelName: string;
  hasMessages: boolean;
}

export function Header({ modelName, hasMessages }: HeaderProps) {
  return (
    <Box flexDirection="column">
      <Text color="#5c8cc8">{HEADER_ART}</Text>
      <Text dimColor italic>  Agentic Software Engineering Framework</Text>
      <Text> </Text>
      <Box flexDirection="column" borderStyle="round" borderColor="#5a6aa8" paddingX={1}>
        <Text> </Text>
        <Text>  <Text dimColor>Model  </Text><Text color="#4ec9b0" bold>{modelName}</Text></Text>
        <Text> </Text>
        <Text dimColor>  I can help you with requirements, planning,</Text>
        <Text dimColor>  implementation, and verification.</Text>
        <Text dimColor>  I have access to your project files, shell, web, and memory.</Text>
        <Text> </Text>
        <Text>  <Text color="#5c8cc8" bold>/help</Text><Text dimColor>     list commands</Text></Text>
        <Text>  <Text color="#5c8cc8" bold>/clear</Text><Text dimColor>    reset conversation</Text></Text>
        <Text>  <Text color="#5c8cc8" bold>/ask</Text><Text dimColor>      {"<question>"}  fast one-shot answer</Text></Text>
        <Text>  <Text color="#5c8cc8" bold>/plan · /develop · /verify</Text><Text dimColor>  workflow commands</Text></Text>
        {hasMessages && (
          <>
            <Text> </Text>
            <Text dimColor>  Resuming previous conversation. /clear to start fresh.</Text>
          </>
        )}
        <Text> </Text>
      </Box>
      <Text> </Text>
    </Box>
  );
}
