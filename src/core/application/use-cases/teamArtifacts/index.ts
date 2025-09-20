import { DismissTeamArtifactUseCase } from './dismiss.use-case';
import { ExecuteTeamArtifactsUseCase } from './execute-teamArtifacts';
import { GetTeamArtifactsUseCase } from './get-team-artifacts.use-case';

export const UseCases = [
    ExecuteTeamArtifactsUseCase,
    GetTeamArtifactsUseCase,
    DismissTeamArtifactUseCase,
];
