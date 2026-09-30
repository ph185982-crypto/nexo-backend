/** Erro de entrada inválida do usuário — a API devolve 400 com a mensagem (em português). */
export class ErroValidacao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroValidacao";
  }
}
