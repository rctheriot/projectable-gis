import { useEffect, useMemo, useRef, useState } from 'react';
import { ArucoPuckSource } from '@/pucks/ArucoPuckSource';
import { CALIBRATION_TARGETS, clearCalibration, saveCalibration } from '@/pucks/calibration';
import { applyHomography, computeHomography, type Correspondence } from '@/pucks/homography';
import type { PuckFrame, PuckReading } from '@/pucks/types';
import { layoutVars, useSettings } from '@/state/useSettings';

interface Props {
  onDone: () => void;
}

/**
 * Teaches the app where the camera is looking.
 *
 * You place one puck on each projected target in turn and capture it. Each capture
 * pairs a camera pixel with a known table position; four pairs determine a
 * homography, and the fifth makes it a least-squares fit that averages out how
 * precisely each puck was placed.
 *
 * This replaces the old routine, where six points were edited into a source file by
 * hand and the residual error was corrected with arrow keys every session.
 */
export function CalibrationView({ onDone }: Props) {
  const settings = useSettings();
  const deviceId = useSettings((s) => s.cameraDeviceId);
  const width = useSettings((s) => s.cameraWidth);
  const height = useSettings((s) => s.cameraHeight);
  const source = useMemo(
    () => new ArucoPuckSource({ deviceId: deviceId || undefined, width, height }),
    [deviceId, width, height],
  );
  const [markers, setMarkers] = useState<PuckReading[]>([]);
  const [captured, setCaptured] = useState<Correspondence[]>([]);
  const [status, setStatus] = useState({ connected: false, detail: 'starting camera' });
  const [saved, setSaved] = useState(false);

  const markersRef = useRef<PuckReading[]>([]);
  markersRef.current = markers;

  useEffect(() => {
    const onFrame = (frame: PuckFrame) => {
      setMarkers(frame);
      setStatus(source.getStatus());
    };
    void source.start(onFrame);
    return () => source.stop();
  }, [source]);

  const step = captured.length;
  const target = CALIBRATION_TARGETS[step];
  const done = step >= CALIBRATION_TARGETS.length;

  // Exactly one marker must be visible, or there is no way to know which puck the
  // capture refers to.
  const visible = markers.filter((m) => m.camera);
  const canCapture = !done && visible.length === 1;

  const capture = () => {
    const only = visible[0];
    if (!only?.camera || !target) return;
    setCaptured((previous) => [
      ...previous,
      { camera: { x: only.camera!.x, y: only.camera!.y }, table: { x: target.x, y: target.y } },
    ]);
  };

  // Residual error tells you whether the calibration is actually good, rather than
  // just complete.
  const residual = useMemo(() => {
    if (captured.length < 4) return null;
    const homography = computeHomography(captured);
    if (!homography) return null;
    const errors = captured.map((point) => {
      const mapped = applyHomography(homography, point.camera.x, point.camera.y);
      return Math.hypot(mapped.x - point.table.x, mapped.y - point.table.y);
    });
    return Math.max(...errors);
  }, [captured]);

  const save = () => {
    const first = markers[0]?.camera;
    const result = saveCalibration(captured, first?.width ?? 1920, first?.height ?? 1080);
    if (result) setSaved(true);
  };

  return (
    /*
     * The layout deliberately mirrors the table: the camera under the table sees
     * only the puck area, so the targets have to be projected inside that same
     * region. Table coordinates are normalised across this zone, not the screen,
     * so a target at 0.5, 0.5 must land at the middle of the puck area.
     */
    <div className="calibration" style={layoutVars(settings)}>
      <div className="calibration__rail">
        <div className="calibration__railTop">
          <p className="calibration__zoneNote">
            The camera sees only the puck area below. Targets are projected there.
          </p>
        </div>

        <div className="calibration__field">
          {CALIBRATION_TARGETS.map((point, index) => (
            <div
              key={`${point.x}-${point.y}`}
              className={`calibration__target${index === step ? ' is-current' : ''}${index < step ? ' is-done' : ''}`}
              style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
            >
              <span className="calibration__targetIndex">{index + 1}</span>
            </div>
          ))}
          <p className="puck-zone__hint">Puck area</p>
        </div>
      </div>

      <div className="calibration__panel">
        <h1 className="calibration__title">Calibrate the table</h1>

        {done ? (
          <p className="calibration__step">
            All {CALIBRATION_TARGETS.length} points captured.
            {residual !== null ? (
              <>
                {' '}
                Worst fit error <strong>{(residual * 100).toFixed(1)}%</strong> of table width
                {residual > 0.02 ? ' — that is high, consider starting over.' : '.'}
              </>
            ) : null}
          </p>
        ) : (
          <p className="calibration__step">
            Place a puck on target <strong>{step + 1}</strong> of {CALIBRATION_TARGETS.length}, then capture.
            Use the same puck each time and keep the others off the table.
          </p>
        )}

        <p className="calibration__seen">
          {visible.length === 0
            ? 'No marker visible.'
            : visible.length === 1
              ? `Marker ${visible[0]?.markerId} visible.`
              : `${visible.length} markers visible — remove all but one.`}
        </p>

        <div className="calibration__actions">
          {!done ? (
            <button type="button" className="button button--primary" onClick={capture} disabled={!canCapture}>
              Capture point {step + 1}
            </button>
          ) : (
            <button type="button" className="button button--primary" onClick={save} disabled={saved}>
              {saved ? 'Saved' : 'Save calibration'}
            </button>
          )}

          <button
            type="button"
            className="button"
            onClick={() => {
              setCaptured([]);
              setSaved(false);
              clearCalibration();
            }}
          >
            Start over
          </button>

          <button type="button" className="button" onClick={onDone}>
            {saved ? 'Done' : 'Cancel'}
          </button>
        </div>

        <p className="calibration__status">
          <span className={`status-bar__dot${status.connected ? ' is-connected' : ''}`} aria-hidden /> {status.detail}
        </p>
      </div>
    </div>
  );
}
