import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { BotInstance } from "@shared/schema";

interface BotFeaturesModalProps {
  bot: BotInstance;
  isOpen: boolean;
  onClose: () => void;
}

interface FeatureDefinition {
  id: string;
  label: string;
  description: string;
  apiKey: string;
  getValue: (bot: BotInstance) => boolean;
}

export function BotFeaturesModal({ bot, isOpen, onClose }: BotFeaturesModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [features, setFeatures] = useState<Record<string, boolean>>(() => {
    return {
      autoView: bot.autoViewStatus || false,
      typingIndicator: bot.typingMode !== 'none',
      chatGPT: bot.chatgptEnabled || false,
      alwaysOnline: bot.alwaysOnline || false,
      autoRecording: bot.presenceMode === 'recording',
      presenceAutoSwitch: bot.presenceAutoSwitch || false,
    };
  });

  const toggleFeatureMutation = useMutation({
    mutationFn: ({ feature, enabled }: { feature: string; enabled: boolean }) => {
      return apiRequest('POST', `/api/bot-instances/${bot.id}/toggle-feature`, { feature, enabled });
    },
    onSuccess: (_, { feature, enabled }) => {
      setFeatures(prev => ({ ...prev, [feature]: enabled }));
      queryClient.invalidateQueries({ queryKey: ["/api/bots/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/approved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances"] });
      toast({ title: "Feature updated successfully" });
    },
    onError: (error) => {
      toast({
        title: "Failed to update feature",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  });

  const handleFeatureToggle = (feature: string, enabled: boolean) => {
    toggleFeatureMutation.mutate({ feature, enabled });
  };

  const automationFeatures: FeatureDefinition[] = [
    {
      id: 'autoView',
      label: 'Auto View Status',
      description: 'Automatically view WhatsApp status',
      apiKey: 'autoView',
      getValue: () => features.autoView
    },
  ];

  const presenceFeatures: FeatureDefinition[] = [
    {
      id: 'typingIndicator',
      label: 'Typing Indicator',
      description: 'Show typing indicator for responses',
      apiKey: 'typingIndicator',
      getValue: () => features.typingIndicator
    },
    {
      id: 'autoRecording',
      label: 'Auto Recording',
      description: 'Show recording indicator automatically',
      apiKey: 'autoRecording',
      getValue: () => features.autoRecording
    },
    {
      id: 'alwaysOnline',
      label: 'Always Online',
      description: 'Keep bot status as online always',
      apiKey: 'alwaysOnline',
      getValue: () => features.alwaysOnline
    },
    {
      id: 'presenceAutoSwitch',
      label: 'Auto Switch Typing/Recording',
      description: 'Switch between typing and recording every 30 seconds',
      apiKey: 'presenceAutoSwitch',
      getValue: () => features.presenceAutoSwitch
    },
  ];

  const aiFeatures: FeatureDefinition[] = [
    {
      id: 'chatGPT',
      label: 'ChatGPT Integration',
      description: 'Enable AI responses for conversations',
      apiKey: 'chatGPT',
      getValue: () => features.chatGPT
    },
  ];

  const renderFeatureSection = (title: string, features: FeatureDefinition[]) => (
    <div className="space-y-3" data-testid={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <h4 className="font-medium text-sm text-foreground">{title}</h4>
      <div className="space-y-3">
        {features.map((feature) => (
          <div key={feature.id} className="flex items-start space-x-3" data-testid={`feature-${feature.id}`}>
            <Checkbox
              id={feature.id}
              checked={feature.getValue(bot)}
              onCheckedChange={(checked) => handleFeatureToggle(feature.apiKey, !!checked)}
              disabled={toggleFeatureMutation.isPending || bot.approvalStatus !== 'approved'}
              data-testid={`checkbox-${feature.id}`}
            />
            <div className="flex-1">
              <Label htmlFor={feature.id} className="text-sm font-medium cursor-pointer">
                {feature.label}
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                {feature.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="modal-bot-features">
        <DialogHeader>
          <DialogTitle data-testid="modal-title">
            Manage Bot Features - {bot.name}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {bot.approvalStatus !== 'approved' && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
              <p className="text-sm text-yellow-800">
                ⚠️ Bot must be approved before features can be managed
              </p>
            </div>
          )}

          {renderFeatureSection("Automation", automationFeatures)}
          
          <Separator />
          
          {renderFeatureSection("Presence", presenceFeatures)}
          
          <Separator />
          
          {renderFeatureSection("AI Integration", aiFeatures)}
          
          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="outline" onClick={onClose} data-testid="button-close">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}