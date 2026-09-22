import { useEffect, useState } from 'react';
import { clearCalibration, loadCalibration, saveCalibration, type Calibration } from '@/pucks/calibration';
import type { SourceKind } from '@/pucks/usePucks';
import { DEFAULT_SETTINGS, useSettings } from '@/state/useSettings';

interface Props {
  onDone: () => void;
}

const SOURCES: { value: SourceKind; label: string; hint: string }[] = [
  { value: 'keyboard', label: 'Keyboard', hint: 'For development. Arrows rotate, WASD slide, 1-4 pick a puck.' },
  { value: 'camera', label: 'Webcam', hint: 'The camera under the table. Needs a calibration.' },
  { value: 'websocket', label: 'External tracker', hint: 'A separate detector process sending table coordinates.' },
];

/**
 * Rig settings.
 *
 * Everything here describes the physical installation and is stored in this
 * browser, not in the repository -- the same build runs on a laptop and on the
 * table, and only this machine knows which camera it has or how wide its puck area
 * is. The old project kept these as constants that had to be edited and rebuilt.
 */
export function SettingsView({ onDone }: Props) {
  const settings = useSettings();
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setCalibration(loadCalibration());
  }, []);

  // Device labels are only exposed once camera permission has been granted, so
  // this stays quiet until the user asks for the list.
  const listCameras = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((device) => device.kind === 'videoinput'));
    } catch (error) {
      setMessage(`Could not list cameras: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const exportCalibration = () => {
    if (!calibration) return;
    const blob = new Blob([JSON.stringify(calibration, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'projectable-calibration.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const importCalibration = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Calibration;
      if (!Array.isArray(parsed.points) || parsed.points.length < 4) {
        throw new Error('file has fewer than four calibration points');
      }
      const saved = saveCalibration(parsed.points, parsed.width, parsed.height);
      if (!saved) throw new Error('points are degenerate; no homography could be solved');
      setCalibration(saved);
      setMessage('Calibration imported.');
    } catch (error) {
      setMessage(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const number = (key: 'railWidth' | 'legendWidth' | 'puckSize' | 'cameraWidth' | 'cameraHeight') => (
    <input
      type="number"
      className="field__input"
      value={settings[key]}
      min={1}
      onChange={(event) => settings.set(key, Math.max(1, Number(event.target.value) || DEFAULT_SETTINGS[key]))}
    />
  );

  return (
    <main className="settings">
      <header className="settings__header">
        <button type="button" className="explore__back" onClick={onDone}>
          &larr; Back
        </button>
        <h1 className="settings__title">Settings</h1>
        <p className="settings__lede">
          Stored in this browser only. These describe the physical rig, so each machine keeps its own.
        </p>
      </header>

      <section className="settings__section">
        <h2 className="settings__sectionTitle">Puck input</h2>
        <div className="settings__choices">
          {SOURCES.map((option) => (
            <label key={option.value} className={`choice${settings.puckSource === option.value ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="puckSource"
                checked={settings.puckSource === option.value}
                onChange={() => settings.set('puckSource', option.value)}
              />
              <span className="choice__label">{option.label}</span>
              <span className="choice__hint">{option.hint}</span>
            </label>
          ))}
        </div>

        {settings.puckSource === 'websocket' ? (
          <label className="field">
            <span className="field__label">Tracker URL</span>
            <input
              type="text"
              className="field__input"
              value={settings.trackerUrl}
              onChange={(event) => settings.set('trackerUrl', event.target.value)}
            />
          </label>
        ) : null}
      </section>

      {settings.puckSource === 'camera' ? (
        <section className="settings__section">
          <h2 className="settings__sectionTitle">Camera</h2>

          <label className="field">
            <span className="field__label">Device</span>
            <select
              className="field__input"
              value={settings.cameraDeviceId}
              onChange={(event) => settings.set('cameraDeviceId', event.target.value)}
            >
              <option value="">Browser default</option>
              {cameras.map((camera) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label || camera.deviceId.slice(0, 12)}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className="button" onClick={listCameras}>
            {cameras.length ? 'Refresh camera list' : 'List cameras'}
          </button>

          <div className="settings__row">
            <label className="field">
              <span className="field__label">Capture width</span>
              {number('cameraWidth')}
            </label>
            <label className="field">
              <span className="field__label">Capture height</span>
              {number('cameraHeight')}
            </label>
          </div>
          <p className="settings__note">
            Requested, not guaranteed &mdash; the camera gives what it can. Detection runs at whatever it returns,
            so higher is better until the frame rate drops.
          </p>
        </section>
      ) : null}

      <section className="settings__section">
        <h2 className="settings__sectionTitle">Calibration</h2>
        {calibration ? (
          <p className="settings__note">
            Saved {new Date(calibration.savedAt).toLocaleString()} from {calibration.points.length} points at{' '}
            {calibration.width}&times;{calibration.height}.
          </p>
        ) : (
          <p className="settings__note">
            No calibration stored. Open a story in table mode with the webcam source and choose Calibrate.
          </p>
        )}

        <div className="settings__actions">
          <button type="button" className="button" onClick={exportCalibration} disabled={!calibration}>
            Export
          </button>
          <label className="button">
            Import
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importCalibration(file);
              }}
            />
          </label>
          <button
            type="button"
            className="button"
            disabled={!calibration}
            onClick={() => {
              clearCalibration();
              setCalibration(null);
              setMessage('Calibration cleared.');
            }}
          >
            Clear
          </button>
        </div>
        <p className="settings__note">
          Export before changing anything on the rig &mdash; a calibration takes a few minutes to redo, and clearing
          browser data takes it with everything else.
        </p>
      </section>

      <section className="settings__section">
        <h2 className="settings__sectionTitle">Table layout</h2>
        <div className="settings__row">
          <label className="field">
            <span className="field__label">Puck rail width (px)</span>
            {number('railWidth')}
          </label>
          <label className="field">
            <span className="field__label">Layer list width (px)</span>
            {number('legendWidth')}
          </label>
          <label className="field">
            <span className="field__label">Puck halo size (px)</span>
            {number('puckSize')}
          </label>
        </div>
        <p className="settings__note">
          The rail covers a real region of the table &mdash; the area the camera sees &mdash; so it is a fixed pixel
          width rather than a share of the screen. Tune it once against the physical model.
        </p>
      </section>

      {message ? <p className="settings__message">{message}</p> : null}

      <div className="settings__actions">
        <button type="button" className="button" onClick={() => settings.reset()}>
          Reset all to defaults
        </button>
      </div>
    </main>
  );
}
