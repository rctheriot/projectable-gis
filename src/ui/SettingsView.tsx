import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearCalibration, loadCalibration, saveCalibration, type Calibration } from '@/pucks/calibration';
import type { SourceKind } from '@/pucks/usePucks';
import { DEFAULT_SETTINGS, pickSettings, useSettings, type Settings } from '@/state/useSettings';

interface Props {
  onDone: () => void;
  onCalibrate: () => void;
}

const SOURCES: { value: SourceKind; label: string; hint: string }[] = [
  { value: 'keyboard', label: 'Keyboard', hint: 'For development. Arrows rotate, WASD slide, 1-4 pick a puck.' },
  { value: 'camera', label: 'Webcam', hint: 'The camera under the table. Needs a calibration.' },
  { value: 'websocket', label: 'External tracker', hint: 'A separate detector process sending table coordinates.' },
];

type NumericKey = {
  [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onValidity: (valid: boolean) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Shown and typed in a different scale from the stored value, e.g. 0.5 as 50%. */
  scale?: number;
}

/**
 * A number input that lets you type.
 *
 * The text is kept as a draft string and only committed while it parses to a
 * number in range, so clearing the field to type a new value leaves it empty
 * rather than snapping back to a default mid-edit. An invalid entry is flagged and
 * blocks Save; leaving the field restores the last good value.
 */
function NumberField({ label, value, onChange, onValidity, min, max, step = 1, unit, scale = 1 }: NumberFieldProps) {
  const format = useCallback((v: number) => String(Math.round(v * scale * 1000) / 1000), [scale]);
  const [text, setText] = useState(() => format(value));
  const [focused, setFocused] = useState(false);

  // Follow outside changes (Discard, Reset) unless the user is mid-edit.
  useEffect(() => {
    if (!focused) setText(format(value));
  }, [value, focused, format]);

  const parsed = text.trim() === '' ? NaN : Number(text) / scale;
  const valid = Number.isFinite(parsed) && (min === undefined || parsed >= min) && (max === undefined || parsed <= max);

  useEffect(() => onValidity(valid), [valid, onValidity]);
  // A field that is hidden (say, the camera section) must not keep blocking Save.
  useEffect(() => () => onValidity(true), [onValidity]);

  const range =
    min !== undefined && max !== undefined
      ? `${format(min)}–${format(max)}`
      : min !== undefined
        ? `≥ ${format(min)}`
        : null;

  return (
    <label className={`field${valid ? '' : ' is-invalid'}`}>
      <span className="field__label">{label}</span>
      <span className="field__control">
        <input
          type="text"
          inputMode="decimal"
          className="field__input field__input--number"
          value={text}
          onFocus={(event) => {
            setFocused(true);
            event.currentTarget.select();
          }}
          onBlur={() => {
            setFocused(false);
            setText(format(value));
          }}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const n = next.trim() === '' ? NaN : Number(next) / scale;
            if (Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) onChange(n);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const delta = (event.key === 'ArrowUp' ? step : -step) * (event.shiftKey ? 10 : 1);
            let n = (Number.isFinite(parsed) ? parsed : value) + delta / scale;
            if (min !== undefined) n = Math.max(min, n);
            if (max !== undefined) n = Math.min(max, n);
            setText(format(n));
            onChange(n);
          }}
        />
        {unit ? <span className="field__unit">{unit}</span> : null}
      </span>
      <span className="field__hint">{valid ? range : `Enter a number${range ? ` (${range})` : ''}`}</span>
    </label>
  );
}

/** A live view of the selected camera, so it can be checked without opening a story. */
function CameraPreview({ deviceId, width, height }: { deviceId: string; width: number; height: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [detail, setDetail] = useState('starting camera');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const size = { width: { ideal: width }, height: { ideal: height } };

    const open = async () => {
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: deviceId ? { ...size, deviceId: { exact: deviceId } } : size,
          });
        } catch (error) {
          if (!deviceId || !(error instanceof DOMException) || error.name !== 'OverconstrainedError') throw error;
          stream = await navigator.mediaDevices.getUserMedia({ video: size });
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) videoRef.current.srcObject = stream;
        const actual = stream.getVideoTracks()[0]?.getSettings();
        setDetail(`${actual?.width ?? '?'}×${actual?.height ?? '?'} at ${actual?.frameRate ?? '?'} fps`);
      } catch (error) {
        if (!cancelled) setDetail(`No camera: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    void open();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [deviceId, width, height]);

  return (
    <figure className="camera-preview">
      <video ref={videoRef} className="camera-preview__video" autoPlay muted playsInline />
      <figcaption className="camera-preview__caption">{detail}</figcaption>
    </figure>
  );
}

/**
 * Rig settings.
 *
 * Everything here describes the physical installation and is stored in this
 * browser, not in the repository -- the same build runs on a laptop and on the
 * table, and only this machine knows which camera it has or how wide its puck area
 * is.
 *
 * Edits are held in a draft until Save, so a half-typed number never reaches the
 * table. Layout and alignment can also be adjusted live on the table itself (the
 * Adjust button); those save as you go, and show up here.
 */
export function SettingsView({ onDone, onCalibrate }: Props) {
  const stored = useSettings();
  const storedValues = useMemo(() => pickSettings(stored), [stored]);

  const [draft, setDraft] = useState<Settings>(storedValues);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [leaving, setLeaving] = useState(false);

  const dirty = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).some((key) => draft[key] !== storedValues[key]);
  const canSave = dirty && invalid.size === 0;

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setLeaving(false);
  };

  // One stable callback per field, so a field's validity effect does not re-run
  // every render.
  const validityHandlers = useRef(new Map<string, (valid: boolean) => void>());
  const validityFor = (key: string) => {
    let handler = validityHandlers.current.get(key);
    if (!handler) {
      handler = (valid: boolean) =>
        setInvalid((previous) => {
          if (valid !== previous.has(key)) return previous;
          const next = new Set(previous);
          if (valid) next.delete(key);
          else next.add(key);
          return next;
        });
      validityHandlers.current.set(key, handler);
    }
    return handler;
  };

  const save = useCallback(() => {
    if (!canSave) return false;
    useSettings.getState().apply(draft);
    setMessage({ text: 'Settings saved to this browser.', tone: 'ok' });
    return true;
  }, [canSave, draft]);

  const discard = () => {
    setDraft(storedValues);
    setLeaving(false);
    setMessage(null);
  };

  const back = () => {
    if (dirty) setLeaving(true);
    else onDone();
  };

  useEffect(() => {
    setCalibration(loadCalibration());
    // If camera permission was granted before, device names are available without
    // asking again.
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        const video = devices.filter((device) => device.kind === 'videoinput');
        if (video.some((device) => device.label)) setCameras(video);
      })
      .catch(() => undefined);
  }, []);

  // Cmd/Ctrl+S saves, as everywhere else.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  // Device labels are only exposed once camera permission has been granted.
  const listCameras = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((device) => device.kind === 'videoinput'));
    } catch (error) {
      setMessage({ text: `Could not list cameras: ${error instanceof Error ? error.message : String(error)}`, tone: 'error' });
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
      setMessage({ text: 'Calibration imported.', tone: 'ok' });
    } catch (error) {
      setMessage({ text: `Import failed: ${error instanceof Error ? error.message : String(error)}`, tone: 'error' });
    }
  };

  const number = (key: NumericKey, label: string, options: Omit<NumberFieldProps, 'label' | 'value' | 'onChange' | 'onValidity'> = {}) => (
    <NumberField
      label={label}
      value={draft[key]}
      onChange={(value) => update(key, value)}
      onValidity={validityFor(key)}
      {...options}
    />
  );

  const cameraLabel = (camera: MediaDeviceInfo, index: number) => camera.label || `Camera ${index + 1}`;
  const savedCameraMissing =
    draft.cameraDeviceId !== '' && cameras.length > 0 && !cameras.some((camera) => camera.deviceId === draft.cameraDeviceId);

  return (
    <main className="settings">
      <div className="settings__inner">
        <header className="settings__header">
          <button type="button" className="explore__back" onClick={back}>
            &larr; Back
          </button>
          <h1 className="settings__title">Settings</h1>
          <p className="settings__lede">
            Saved in this browser only. These describe the physical rig, so each machine keeps its own.
          </p>
        </header>

        {/* ---------------------------------------------------------- input */}
        <section className="settings__card">
          <div className="settings__cardHead">
            <h2 className="settings__sectionTitle">Puck input</h2>
          </div>
          <div className="settings__choices">
            {SOURCES.map((option) => (
              <label key={option.value} className={`choice${draft.puckSource === option.value ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name="puckSource"
                  checked={draft.puckSource === option.value}
                  onChange={() => update('puckSource', option.value)}
                />
                <span className="choice__label">{option.label}</span>
                <span className="choice__hint">{option.hint}</span>
              </label>
            ))}
          </div>

          {draft.puckSource === 'websocket' ? (
            <label className="field field--wide">
              <span className="field__label">Tracker URL</span>
              <input
                type="text"
                className="field__input"
                value={draft.trackerUrl}
                onChange={(event) => update('trackerUrl', event.target.value)}
              />
            </label>
          ) : null}
        </section>

        {/* --------------------------------------------------------- camera */}
        {draft.puckSource === 'camera' ? (
          <section className="settings__card">
            <div className="settings__cardHead">
              <h2 className="settings__sectionTitle">Camera</h2>
            </div>

            <div className="settings__row settings__row--end">
              <label className="field field--wide">
                <span className="field__label">Device</span>
                <select
                  className="field__input"
                  value={draft.cameraDeviceId}
                  onChange={(event) => update('cameraDeviceId', event.target.value)}
                >
                  <option value="">Browser default</option>
                  {cameras.map((camera, index) => (
                    <option key={camera.deviceId} value={camera.deviceId}>
                      {cameraLabel(camera, index)}
                    </option>
                  ))}
                  {savedCameraMissing ? <option value={draft.cameraDeviceId}>Saved camera (not connected)</option> : null}
                </select>
              </label>
              <button type="button" className="button" onClick={listCameras}>
                {cameras.length ? 'Refresh list' : 'Find cameras'}
              </button>
              <button type="button" className="button" onClick={() => setPreviewing((on) => !on)}>
                {previewing ? 'Stop preview' : 'Test camera'}
              </button>
            </div>

            {savedCameraMissing ? (
              <p className="settings__note settings__note--warn">
                The saved camera is not connected. The table will fall back to the browser default.
              </p>
            ) : null}

            {previewing ? (
              <CameraPreview deviceId={draft.cameraDeviceId} width={draft.cameraWidth} height={draft.cameraHeight} />
            ) : null}

            <div className="settings__row">
              {number('cameraWidth', 'Capture width', { min: 160, max: 7680, unit: 'px' })}
              {number('cameraHeight', 'Capture height', { min: 120, max: 4320, unit: 'px' })}
            </div>
            <p className="settings__note">
              Requested, not guaranteed &mdash; the camera gives what it can. 1920&times;1080 at 30fps is a good
              target; the frame is scaled down for detection anyway.
            </p>

            <h3 className="settings__groupTitle">Tracking</h3>
            <div className="settings__row">
              {number('detectionWidth', 'Detection width', { min: 320, max: 3840, unit: 'px', step: 80 })}
              {number('holdMs', 'Hold lost pucks for', { min: 0, max: 5000, unit: 'ms', step: 50 })}
              {number('maxBitErrors', 'Bit errors allowed', { min: 0, max: 8, unit: 'bits' })}
            </div>
            <p className="settings__note">
              <strong>Detection width</strong> is the size frames are scaled to before looking for markers. The
              status bar shows how big markers appear (&ldquo;markers ~48px&rdquo;); aim for roughly 30px or more.
              If they read smaller, raise this; if much larger, lowering it makes detection faster. <strong>Hold</strong> keeps a puck in place through brief dropouts; raise it if pucks blink,
              lower it if lifting a puck takes too long to register.
            </p>
            <p className="settings__note">
              <strong>Bit errors allowed</strong>: each marker is 36 cells, and a read may get this many wrong and
              still count. Up to 5 is always safe. 6&ndash;8 reads more blurry markers but can occasionally mistake
              one puck for another. The status bar says why squares were not read: <em>border</em> means glare or
              blur on the marker&rsquo;s edge; <em>pattern</em> with &ldquo;closest N bits off&rdquo; tells you
              whether raising this would help.
            </p>
          </section>
        ) : null}

        {/* ---------------------------------------------------- calibration */}
        <section className="settings__card">
          <div className="settings__cardHead">
            <h2 className="settings__sectionTitle">Calibration</h2>
            <span className={`settings__badge${calibration ? ' is-ok' : ''}`}>
              {calibration ? 'Calibrated' : 'Not calibrated'}
            </span>
          </div>
          <p className="settings__note">
            {calibration
              ? `Saved ${new Date(calibration.savedAt).toLocaleString()} from ${calibration.points.length} points at ${calibration.width}×${calibration.height}.`
              : 'Maps what the camera sees onto the puck area. Needed before the webcam can place pucks.'}
          </p>

          <div className="settings__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={dirty && !canSave}
              onClick={() => {
                if (dirty) save();
                onCalibrate();
              }}
            >
              {dirty ? 'Save and calibrate' : 'Calibrate now'}
            </button>
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
                  event.target.value = '';
                }}
              />
            </label>
            <button
              type="button"
              className="button button--danger"
              disabled={!calibration}
              onClick={() => {
                clearCalibration();
                setCalibration(null);
                setMessage({ text: 'Calibration cleared.', tone: 'ok' });
              }}
            >
              Clear
            </button>
          </div>
          <p className="settings__note">
            Import, export and clear take effect immediately. Export before changing anything on the rig &mdash;
            clearing browser data takes the calibration with it. Recalibrate after changing the puck area&rsquo;s size.
          </p>
        </section>

        {/* --------------------------------------------------------- layout */}
        <section className="settings__card">
          <div className="settings__cardHead">
            <h2 className="settings__sectionTitle">Table layout</h2>
            <button
              type="button"
              className="button button--quiet"
              onClick={() =>
                setDraft((previous) => ({
                  ...previous,
                  railWidth: DEFAULT_SETTINGS.railWidth,
                  chartSplit: DEFAULT_SETTINGS.chartSplit,
                  barGap: DEFAULT_SETTINGS.barGap,
                  legendWidth: DEFAULT_SETTINGS.legendWidth,
                  legendX: DEFAULT_SETTINGS.legendX,
                  legendY: DEFAULT_SETTINGS.legendY,
                  puckSize: DEFAULT_SETTINGS.puckSize,
                }))
              }
            >
              Reset layout
            </button>
          </div>
          <p className="settings__note">
            Easiest done on the table: open a story in table mode and press <strong>Adjust</strong> to drag these
            edges into place. Fine-tune here.
          </p>

          <h3 className="settings__groupTitle">Puck area</h3>
          <div className="settings__row">
            {number('railWidth', 'Width', { min: 200, max: 8000, unit: 'px', step: 10 })}
            {number('chartSplit', 'Chart share of height', { min: 0.1, max: 0.9, unit: '%', scale: 100 })}
            {number('barGap', '80/20 bar gap', { min: 0, max: 400, unit: 'px' })}
            {number('puckSize', 'Puck halo size', { min: 20, max: 600, unit: 'px' })}
          </div>

          <h3 className="settings__groupTitle">Layer list</h3>
          <div className="settings__row">
            {number('legendWidth', 'Width', { min: 160, max: 800, unit: 'px', step: 10 })}
            {number('legendX', 'From map edge', { min: 0, max: 8000, unit: 'px', step: 10 })}
            {number('legendY', 'From top', { min: 0, max: 8000, unit: 'px', step: 10 })}
          </div>
        </section>

        {/* ------------------------------------------------------ alignment */}
        <section className="settings__card">
          <div className="settings__cardHead">
            <h2 className="settings__sectionTitle">Projection alignment</h2>
            <button
              type="button"
              className="button button--quiet"
              onClick={() =>
                setDraft((previous) => ({
                  ...previous,
                  mapScale: DEFAULT_SETTINGS.mapScale,
                  mapOffsetX: DEFAULT_SETTINGS.mapOffsetX,
                  mapOffsetY: DEFAULT_SETTINGS.mapOffsetY,
                  mapRotation: DEFAULT_SETTINGS.mapRotation,
                }))
              }
            >
              Reset alignment
            </button>
          </div>
          <p className="settings__note">
            Lines the map up with the relief model. Easiest by eye on the table with <strong>Adjust</strong>; the
            numbers are here to copy between machines or undo a bad nudge.
          </p>
          <div className="settings__row">
            {number('mapScale', 'Scale', { min: 0.05, max: 20, step: 0.01 })}
            {number('mapOffsetX', 'Offset X', { min: -10000, max: 10000, unit: 'px' })}
            {number('mapOffsetY', 'Offset Y', { min: -10000, max: 10000, unit: 'px' })}
            {number('mapRotation', 'Rotation', { min: -180, max: 180, unit: '°', step: 0.25 })}
          </div>
        </section>

        <section className="settings__card settings__card--quiet">
          <div className="settings__cardHead">
            <h2 className="settings__sectionTitle">Start fresh</h2>
          </div>
          <p className="settings__note">
            Puts every setting above back to its default. Nothing changes until you save. Calibration is kept.
          </p>
          <div className="settings__actions">
            <button type="button" className="button button--danger" onClick={() => setDraft({ ...DEFAULT_SETTINGS })}>
              Reset all to defaults
            </button>
          </div>
        </section>
      </div>

      {/* Always in view, so there is never any doubt whether something is saved. */}
      <footer className={`settings__bar${dirty ? ' is-dirty' : ''}`}>
        <div className="settings__barInner">
          {leaving ? (
            <>
              <span className="settings__barStatus">You have unsaved changes.</span>
              <button type="button" className="button" onClick={() => setLeaving(false)}>
                Keep editing
              </button>
              <button type="button" className="button button--danger" onClick={onDone}>
                Leave without saving
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={!canSave}
                onClick={() => {
                  if (save()) onDone();
                }}
              >
                Save and go back
              </button>
            </>
          ) : (
            <>
              <span
                className={`settings__barStatus${message?.tone === 'error' ? ' is-error' : ''}`}
                role="status"
              >
                {invalid.size > 0
                  ? 'Fix the highlighted fields to save.'
                  : dirty
                    ? 'Unsaved changes'
                    : (message?.text ?? 'All changes saved')}
              </span>
              <button type="button" className="button" onClick={discard} disabled={!dirty}>
                Discard
              </button>
              <button type="button" className="button button--primary" onClick={save} disabled={!canSave}>
                Save
              </button>
            </>
          )}
        </div>
      </footer>
    </main>
  );
}
