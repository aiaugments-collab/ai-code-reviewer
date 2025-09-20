import { IIssuesRepository } from './issues.repository';

export const ISSUES_SERVICE_TOKEN = Symbol('IssuesService');

export interface IIssuesService extends IIssuesRepository {

}