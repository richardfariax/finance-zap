import { normalizeForMatch } from '../../../shared/utils/normalize-text.js';

const RAW_MAP: Record<string, string> = {
  uber: 'Transporte',
  taxi: 'Transporte',
  '99': 'Transporte',
  onibus: 'Transporte',
  combustivel: 'Transporte',
  gasolina: 'Transporte',
  estacionamento: 'Transporte',
  pedagio: 'Transporte',

  mercado: 'Mercado',
  supermercado: 'Mercado',
  padaria: 'Alimentação',
  restaurante: 'Alimentação',
  lanche: 'Alimentação',
  ifood: 'Alimentação',
  alimentacao: 'Alimentação',
  pizza: 'Alimentação',
  hamburguer: 'Alimentação',
  hamburger: 'Alimentação',
  delivery: 'Alimentação',
  acai: 'Alimentação',
  açai: 'Alimentação',
  sorvete: 'Alimentação',
  cafe: 'Alimentação',
  café: 'Alimentação',
  refeicao: 'Alimentação',
  refeição: 'Alimentação',
  jantar: 'Alimentação',
  almoco: 'Alimentação',
  almoço: 'Alimentação',
  cerveja: 'Alimentação',
  bar: 'Alimentação',

  farmacia: 'Saúde',
  hospital: 'Saúde',
  medico: 'Saúde',

  aluguel: 'Moradia',
  condomino: 'Moradia',
  luz: 'Moradia',
  agua: 'Moradia',
  internet: 'Moradia',

  netflix: 'Assinaturas',
  spotify: 'Assinaturas',
  amazon: 'Assinaturas',
  disney: 'Assinaturas',
  assinatura: 'Assinaturas',

  cinema: 'Lazer',
  show: 'Lazer',
  viagem: 'Lazer',

  curso: 'Educação',
  escola: 'Educação',
  faculdade: 'Educação',

  salario: 'Salário',
  freela: 'Vendas',
  freelance: 'Vendas',
  venda: 'Vendas',
  pix: 'Transferências',
};

export const KEYWORD_TO_CATEGORY_NAME: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(RAW_MAP).map(([k, v]) => [normalizeForMatch(k), v]),
);
