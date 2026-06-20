import { Monitor, Music, Sun, Volume2, X } from './Icons';
import React, { useMemo, useState } from 'react';
import type { GameSettings } from '../types';

interface SettingsScreenProps {
  settings: GameSettings;
  onUpdateSetting: (key: keyof GameSettings, value: number) => void;
  onClose: () => void;
  playSfx: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ settings, onUpdateSetting, onClose, playSfx }) => {

  const handleSliderChange = (key: keyof GameSettings, e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    onUpdateSetting(key, value);
  };

  const handleDragEnd = () => {
    playSfx();
  };

  return (
    <div className="game-modal absolute inset-0 z-[60] cozy-overlay flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg h-auto max-h-[85vh] cozy-surface border-[color:var(--color-cozy-border-strong)] relative overflow-hidden flex flex-col rounded-[24px]">
        {/* 背景光效 */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[radial-gradient(circle_at_top_right,rgba(221,184,176,0.15),transparent_70%)] pointer-events-none" />

        {/* Header */}
        <div className="flex justify-between items-center px-8 py-6 border-b border-[color:rgba(161,132,117,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.4),transparent)]">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-cozy-accent)] opacity-80" />
              <h2 className="font-serif-sc text-[17px] text-[var(--color-cozy-ink)] tracking-[0.1em] font-bold">
                设置
              </h2>
            </div>
            <span className="font-mono-retro text-[8px] text-[var(--color-cozy-muted)] tracking-[0.3em] uppercase ml-3.5">
              system_config
            </span>
          </div>
          <button
            onClick={() => {
              playSfx();
              onClose();
            }}
            className="w-8 h-8 flex items-center justify-center bg-[rgba(255,255,255,0.5)] border border-[color:rgba(161,132,117,0.18)] rounded-full text-[var(--color-cozy-muted)] hover:text-[var(--color-cozy-ink)] hover:bg-[rgba(255,255,255,0.8)] shadow-[0_4px_12px_rgba(109,88,76,0.08)] transition-all duration-300 cursor-pointer group"
            onMouseEnter={playSfx}
          >
            <X size={14} className="group-hover:rotate-90 transition-transform duration-300" />
          </button>
        </div>

        {/* Body */}
        <div className="px-8 py-6 flex flex-col gap-5 overflow-y-auto cozy-scrollbar flex-1">
          <ControlRow
            icon={<Volume2 size={16} />}
            label="SFX VOL"
            value={settings.volumeSfx}
            max={1}
            step={0.1}
            onChange={e => handleSliderChange('volumeSfx', e)}
            onDragEnd={handleDragEnd}
            displayValue={`${Math.round(settings.volumeSfx * 100)}%`}
          />
          <div className="cozy-hairline h-px w-full opacity-60" />
          <ControlRow
            icon={<Music size={16} />}
            label="BGM VOL"
            value={settings.volumeMusic}
            max={1}
            step={0.1}
            onChange={e => handleSliderChange('volumeMusic', e)}
            onDragEnd={handleDragEnd}
            displayValue={`${Math.round(settings.volumeMusic * 100)}%`}
          />
          <div className="cozy-hairline h-px w-full opacity-60" />
          <ControlRow
            icon={<Volume2 size={16} />}
            label="VOICE VOL"
            value={settings.volumeVoice}
            max={1}
            step={0.1}
            onChange={e => handleSliderChange('volumeVoice', e)}
            onDragEnd={handleDragEnd}
            displayValue={`${Math.round(settings.volumeVoice * 100)}%`}
          />
          <div className="cozy-hairline h-px w-full opacity-60" />
          <ControlRow
            icon={<Sun size={16} />}
            label="BRIGHTNESS"
            value={settings.brightness}
            max={100}
            step={5}
            onChange={e => handleSliderChange('brightness', e)}
            onDragEnd={handleDragEnd}
            displayValue={`${Math.round(settings.brightness)}%`}
          />
        </div>

        {/* 底部信息 */}
        <div className="px-8 py-4 border-t border-[color:rgba(161,132,117,0.16)] bg-[rgba(255,255,255,0.3)] flex justify-between items-center">
          <span className="text-[9px] font-mono-retro text-[var(--color-cozy-muted)] tracking-[0.2em] opacity-80">
            QUIET_EDITOR_UI
          </span>
          <span className="text-[8px] font-mono-retro text-[var(--color-cozy-muted)] tracking-wider opacity-60">
            v1.3.0
          </span>
        </div>
      </div>
    </div>
  );
};

interface ControlRowProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  max: number;
  step: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragEnd: () => void;
  displayValue: string;
}

const ControlRow: React.FC<ControlRowProps> = ({
  icon,
  label,
  value,
  max,
  step,
  onChange,
  onDragEnd,
  displayValue,
}) => {
  const fillPercent = useMemo(() => (value / max) * 100, [value, max]);

  return (
    <div className="flex flex-col gap-3 group">
      <div className="flex justify-between items-end">
        <div className="flex items-center gap-3 text-[var(--color-cozy-muted)] group-hover:text-[var(--color-cozy-ink)] transition-colors">
          <div className="opacity-80 group-hover:opacity-100 transition-opacity">{icon}</div>
          <span className="font-mono-retro text-[10px] tracking-[0.2em]">{label}</span>
        </div>
        <span className="font-mono-retro text-[var(--color-cozy-ink)] text-xs tabular-nums min-w-[3em] text-right font-bold">
          {displayValue}
        </span>
      </div>
      <div className="relative h-1.5 bg-[rgba(161,132,117,0.12)] rounded-full overflow-hidden border border-[color:rgba(161,132,117,0.06)] shadow-[inset_0_1px_3px_rgba(109,88,76,0.08)]">
        <div
          className="absolute top-0 left-0 h-full bg-[var(--color-cozy-accent)] transition-all duration-150 ease-out shadow-[0_0_8px_rgba(221,184,176,0.6)]"
          style={{ width: `${fillPercent}%` }}
        />
        <input
          type="range"
          min="0"
          max={max}
          step={step}
          value={value}
          onChange={onChange}
          onMouseUp={onDragEnd}
          onTouchEnd={onDragEnd}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
};

