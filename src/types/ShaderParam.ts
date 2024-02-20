type ParamType = 'float' | 'int' | 'vec2';

export interface ShaderParam<Type extends ParamType> {
  type: Type;
  name: string;
  value: ShaderParamValuesMap[Type];
}

interface ShaderParamValuesMap {
  'float': number;
  'int': number;
  'vec2': [number, number];
}

export interface ShaderTextureParam {
  url: string;
  name: string;
}

export type ShaderParamAny = ShaderParam<ParamType>;
