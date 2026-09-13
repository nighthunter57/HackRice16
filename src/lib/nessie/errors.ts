import { IntegrationError } from '../integrations/http';

export class NessieError extends IntegrationError {
  constructor(code: IntegrationError['code'], status?: number) {
    super('Nessie', code, status);
    this.name = 'NessieError';
  }
}
