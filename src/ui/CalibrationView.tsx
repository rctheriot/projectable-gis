import { useEffect, useMemo, useRef, useState } from 'react';
import { ArucoPuckSource } from '@/pucks/ArucoPuckSource';
import { CALIBRATION_TARGETS, saveCalibration } from '@/pucks/calibration';
import { applyHomography, computeHomography, type Correspondence } from '@/pucks/homography';
import type { PuckFrame, PuckReading } from '@/pucks/types';
import { useSettings } from '@/state/useSettings';
import { TableFrame } from './TableFrame';

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
  const deviceId = useSettings((s) => s.cameraDeviceId);
  const width = useSettings((s) => s.cameraWidth);
  const height = useSettings((s) => s.cameraHeight);
  const detectionWidth = useSettings((s) => s.detectionWidth);
  const maxBitErrors = useSettings((s) => s.maxBitErrors);
  const markerSet = useSettings((s) => s.markerSet);
  const source = useMemo(
    () =>
      new ArucoPuckSource({ deviceId: deviceId || undefined, width, height, detectionWidth, maxBitErrors, markerSet }),
    [deviceId, width, height, detectionWidth, maxBitErrors, markerSet],
  );
  const [markers, setMarkers] = useState<PuckReading[]>([]);
  const [captured, setCaptured] = useState<Correspondence[]>([]);
  /** Resolution the points were captured at, stored with the calibration. */
  const [frameSize, setFrameSize] = useState({ width: 1920, height: 1080 });
  const [status, setStatus] = useState({ connected: false, detail: 'starting camera' });
  const [saved, setSaved] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    const onFrame = (frame: PuckFrame) => {
      setMarkers(frame);
      setStatus(source.getStatus());
    };
    const started = source.start(onFrame);
    setStatus(source.getStatus());
    void started.then(() => {
      if (cancelled) return;
      setStream(source.getStream());
      setStatus(source.getStatus());
    });
    return () => {
      cancelled = true;
      source.stop();
      setStream(null);
    };
  }, [source]);

  // The preview shares the detector's stream rather than opening a second one.
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

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
    const camera = only.camera;
    setFrameSize({ width: camera.width, height: camera.height });
    setCaptured((previous) => [...previous, { camera: { x: camera.x, y: camera.y }, table: { x: target.x, y: target.y } }]);
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
    const result = saveCalibration(captured, frameSize.width, frameSize.height);
    if (result) setSaved(true);
  };

  const frameWidth = markers[0]?.camera?.width ?? frameSize.width;
  const frameHeight = markers[0]?.camera?.height ?? frameSize.height;

  const targets = CALIBRATION_TARGETS.map((point, index) => (
    <div
      key={`${point.x}-${point.y}`}
      className={`calibration__target${index === step ? ' is-current' : ''}${index < step ? ' is-done' : ''}`}
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
    >
      <span className="calibration__targetIndex">{index + 1}</span>
    </div>
  ));

  const panel = (
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
          Place a puck on target <strong>{step + 1}</strong> of {CALIBRATION_TARGETS.length} in the puck area, then
          capture. Use the same puck each time and keep the others off the table.
        </p>
      )}

      {/*
        What the camera sees, with every detected marker boxed. Without this there
        is no way to tell a dead camera from one pointed at the wrong place.
      */}
      <div className="calibration__preview" style={{ aspectRatio: `${frameWidth} / ${frameHeight}` }}>
        <video ref={videoRef} className="calibration__video" autoPlay muted playsInline />
        {!stream ? <p className="calibration__previewEmpty">{status.detail}</p> : null}
        <svg className="calibration__markers" viewBox={`0 0 ${frameWidth} ${frameHeight}`} preserveAspectRatio="none">
          {visible.map((marker) => (
            <g key={marker.markerId}>
              <circle cx={marker.camera!.x} cy={marker.camera!.y} r={frameWidth / 60} className="calibration__markerDot" />
              <text x={marker.camera!.x} y={marker.camera!.y - frameWidth / 40} className="calibration__markerLabel">
                {marker.markerId}
              </text>
            </g>
          ))}
        </svg>
      </div>

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

        {/* Only the captured points are dropped; the stored calibration is replaced on Save, not before. */}
        <button
          type="button"
          className="button"
          disabled={captured.length === 0}
          onClick={() => {
            setCaptured([]);
            setSaved(false);
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
  );

  /*
   * The layout is the table's own frame, so the targets land in exactly the region
   * the pucks will later be read in: table coordinates are normalised across the
   * puck zone, not the screen, and a target at 0.5, 0.5 must be its middle.
   */
  return (
    <div className="calibration">
      <TableFrame
        top={<p className="calibration__zoneNote">The camera reads the puck area below. Targets are projected there.</p>}
        pucks={targets}
        area={panel}
      />
    </div>
  );
}
