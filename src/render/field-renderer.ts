// WebGL2 renderer for a scalar field on a triangle mesh, drawn on the deformed
// shape. Colours come from a 1D colormap texture, so per-vertex values are
// interpolated across each triangle by the GPU.

import type { Mesh } from '../core/model';
import { colormapTexels } from './colormap';
import { clipMatrix, type View } from './view';

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_displacement;
layout(location = 2) in float a_value;
uniform mat3 u_clip;
uniform float u_scale;
uniform vec2 u_range;
out float v_t;
void main() {
  vec2 p = a_position + u_scale * a_displacement;
  gl_Position = vec4((u_clip * vec3(p, 1.0)).xy, 0.0, 1.0);
  v_t = (a_value - u_range.x) / (u_range.y - u_range.x);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in float v_t;
uniform sampler2D u_colormap;
uniform float u_bands;
uniform vec4 u_solid; // alpha > 0 draws a flat colour instead of the field
out vec4 outColor;
void main() {
  if (u_solid.a > 0.0) {
    outColor = vec4(u_solid.rgb * u_solid.a, u_solid.a); // premultiplied
    return;
  }
  float t = clamp(v_t, 0.0, 1.0);
  if (u_bands > 0.0) t = (min(floor(t * u_bands), u_bands - 1.0) + 0.5) / u_bands;
  outColor = texture(u_colormap, vec2(t, 0.5));
}`;

export interface DrawOptions {
  view: View;
  /** Device pixels per CSS pixel. */
  dpr: number;
  deformationScale: number;
  range: [number, number];
  /** Number of flat colour bands, or 0 for a continuous map. */
  bands: number;
  showMesh: boolean;
}

export class FieldRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<'clip' | 'scale' | 'range' | 'colormap' | 'bands' | 'solid', WebGLUniformLocation>;
  private readonly triangles: WebGLVertexArrayObject;
  private readonly lines: WebGLVertexArrayObject;
  private readonly buffers: Record<'triPosition' | 'triDisplacement' | 'value' | 'linePosition' | 'lineDisplacement', WebGLBuffer>;
  private readonly texture: WebGLTexture;
  private triangleVertexCount = 0;
  private lineVertexCount = 0;
  private elements: Uint32Array = new Uint32Array();
  /** Mean element edge length, mm. */
  private edgeLength = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);

    const uniform = (name: string) => {
      const location = gl.getUniformLocation(this.program, name);
      if (!location) throw new Error(`Missing uniform ${name}`);
      return location;
    };
    this.uniforms = {
      clip: uniform('u_clip'),
      scale: uniform('u_scale'),
      range: uniform('u_range'),
      colormap: uniform('u_colormap'),
      bands: uniform('u_bands'),
      solid: uniform('u_solid'),
    };

    this.buffers = {
      triPosition: gl.createBuffer(),
      triDisplacement: gl.createBuffer(),
      value: gl.createBuffer(),
      linePosition: gl.createBuffer(),
      lineDisplacement: gl.createBuffer(),
    };
    this.triangles = gl.createVertexArray();
    gl.bindVertexArray(this.triangles);
    this.attribute(0, this.buffers.triPosition, 2);
    this.attribute(1, this.buffers.triDisplacement, 2);
    this.attribute(2, this.buffers.value, 1);
    this.lines = gl.createVertexArray();
    gl.bindVertexArray(this.lines);
    this.attribute(0, this.buffers.linePosition, 2);
    this.attribute(1, this.buffers.lineDisplacement, 2);
    gl.bindVertexArray(null);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    for (const [param, value] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ]) {
      gl.texParameteri(gl.TEXTURE_2D, param, value);
    }
  }

  setColormap(stops: readonly string[]): void {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, colormapTexels(stops));
  }

  /** Uploads geometry: each triangle gets its own 3 vertices so values can be flat per element. */
  setMesh(mesh: Mesh, displacements: Float64Array): void {
    const { gl } = this;
    const { nodes, elements } = mesh;
    this.elements = elements;
    const nVerts = elements.length;

    const positions = new Float32Array(2 * nVerts);
    const disp = new Float32Array(2 * nVerts);
    for (let v = 0; v < nVerts; v++) {
      const n = elements[v];
      positions[2 * v] = nodes[2 * n];
      positions[2 * v + 1] = nodes[2 * n + 1];
      disp[2 * v] = displacements[2 * n];
      disp[2 * v + 1] = displacements[2 * n + 1];
    }
    this.upload(this.buffers.triPosition, positions, gl.STATIC_DRAW);
    this.upload(this.buffers.triDisplacement, disp, gl.STATIC_DRAW);
    this.upload(this.buffers.value, new Float32Array(nVerts), gl.DYNAMIC_DRAW);
    this.triangleVertexCount = nVerts;

    // Unique element edges for the mesh overlay.
    const nNodes = nodes.length / 2;
    const seen = new Set<number>();
    const linePositions: number[] = [];
    const lineDisp: number[] = [];
    let totalLength = 0;
    for (let e = 0; e < elements.length; e += 3) {
      for (let k = 0; k < 3; k++) {
        const a = elements[e + k];
        const b = elements[e + ((k + 1) % 3)];
        const key = Math.min(a, b) * nNodes + Math.max(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        totalLength += Math.hypot(nodes[2 * b] - nodes[2 * a], nodes[2 * b + 1] - nodes[2 * a + 1]);
        for (const n of [a, b]) {
          linePositions.push(nodes[2 * n], nodes[2 * n + 1]);
          lineDisp.push(displacements[2 * n], displacements[2 * n + 1]);
        }
      }
    }
    this.upload(this.buffers.linePosition, Float32Array.from(linePositions), gl.STATIC_DRAW);
    this.upload(this.buffers.lineDisplacement, Float32Array.from(lineDisp), gl.STATIC_DRAW);
    this.lineVertexCount = linePositions.length / 2;
    this.edgeLength = seen.size > 0 ? totalLength / seen.size : 0;
  }

  /** Values per node (smoothed) or per element (raw), matching the last setMesh. */
  setValues(values: Float64Array, perElement: boolean): void {
    const { gl, elements } = this;
    const data = new Float32Array(elements.length);
    for (let v = 0; v < elements.length; v++) data[v] = perElement ? values[Math.floor(v / 3)] : values[elements[v]];
    this.upload(this.buffers.value, data, gl.DYNAMIC_DRAW);
  }

  draw({ view, dpr, deformationScale, range, bands, showMesh }: DrawOptions): void {
    const { gl, uniforms } = this;
    const canvas = gl.canvas as HTMLCanvasElement;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.triangleVertexCount === 0) return;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(uniforms.clip, false, clipMatrix(view));
    gl.uniform1f(uniforms.scale, deformationScale);
    gl.uniform2f(uniforms.range, range[0], range[1] > range[0] ? range[1] : range[0] + 1);
    gl.uniform1f(uniforms.bands, bands);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(uniforms.colormap, 0);

    gl.disable(gl.BLEND);
    gl.uniform4f(uniforms.solid, 0, 0, 0, 0);
    gl.bindVertexArray(this.triangles);
    gl.drawArrays(gl.TRIANGLES, 0, this.triangleVertexCount);

    // Skip mesh lines once elements shrink below ~4 device pixels: they would
    // only darken the field.
    if (showMesh && this.lineVertexCount > 0 && this.edgeLength * view.zoom * dpr >= 4) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform4f(uniforms.solid, 0.05, 0.07, 0.09, 0.45);
      gl.bindVertexArray(this.lines);
      gl.drawArrays(gl.LINES, 0, this.lineVertexCount);
    }
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const { gl } = this;
    for (const buffer of Object.values(this.buffers)) gl.deleteBuffer(buffer);
    gl.deleteVertexArray(this.triangles);
    gl.deleteVertexArray(this.lines);
    gl.deleteTexture(this.texture);
    gl.deleteProgram(this.program);
  }

  /** Points attribute `location` of the currently bound VAO at `buffer`. */
  private attribute(location: number, buffer: WebGLBuffer, size: number): void {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }

  private upload(buffer: WebGLBuffer, data: Float32Array, usage: number): void {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  }
}

function linkProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Could not create shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}
