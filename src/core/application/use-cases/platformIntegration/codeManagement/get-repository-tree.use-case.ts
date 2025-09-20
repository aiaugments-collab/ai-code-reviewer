import { PinoLoggerService } from '@/core/infrastructure/adapters/services/logger/pino.service';
import { CodeManagementService } from '@/core/infrastructure/adapters/services/platformIntegration/codeManagement.service';
import { GetRepositoryTreeDto } from '@/core/infrastructure/http/dtos/get-repository-tree.dto';
import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { CacheService } from '@/shared/utils/cache/cache.service';
import { RepositoryTreeType } from '@/shared/utils/enums/repositoryTree.enum';
import { GetAdditionalInfoHelper } from '@/shared/utils/helpers/getAdditionalInfo.helper';
import { Injectable } from '@nestjs/common';

export interface TreeItem {
    path: string;
    type: 'file' | 'directory';
    sha: string;
    size?: number;
    url: string;
}

export interface DirectoryStructure {
    name: string;
    path: string;
    files: Array<{ name: string; path: string }>;
    subdirectories: DirectoryStructure[];
}

export interface FileItem {
    name: string;
    path: string;
}

type AllTreeItem = DirectoryStructure | FileItem;

@Injectable()
export class GetRepositoryTreeUseCase implements IUseCase {
    constructor(
        private readonly codeManagementService: CodeManagementService,
        private readonly logger: PinoLoggerService,
        private readonly getAdditionalInfoHelper: GetAdditionalInfoHelper,

        private readonly cacheService: CacheService,
    ) {}

    public async execute(params: GetRepositoryTreeDto) {
        try {
            const key = `repo-tree-${params.organizationId}-${params.teamId}-${params.repositoryId}`;

            const cached = await this.cacheService.getFromCache<{
                tree: TreeItem[];
            }>(key);

            let repositoryTree: TreeItem[] = [];
            if (cached && params.useCache) {
                repositoryTree = cached.tree;
            } else {
                const fetchedTree =
                    await this.codeManagementService.getRepositoryTree({
                        organizationAndTeamData: {
                            organizationId: params.organizationId,
                            teamId: params.teamId,
                        },
                        repositoryId: params.repositoryId,
                    });

                repositoryTree = fetchedTree || [];

                await this.cacheService.addToCache(
                    key,
                    { tree: repositoryTree },
                    900000,
                ); // 15 minutes
            }

            let tree: AllTreeItem[] = [];
            switch (params.treeType) {
                case RepositoryTreeType.DIRECTORIES:
                    tree = this.formatDirectoriesOnly(repositoryTree);
                    break;

                case RepositoryTreeType.FILES:
                    tree = this.formatFilesOnly(repositoryTree);
                    break;

                case RepositoryTreeType.ALL:
                default:
                    tree = this.formatAllTree(repositoryTree);
                    break;
            }

            return {
                repository:
                    await this.getAdditionalInfoHelper.getRepositoryNameByOrganizationAndRepository(
                        params.organizationId,
                        params.repositoryId,
                    ),
                tree: tree,
            };
        } catch (error) {
            this.logger.error({
                message: 'Error while getting repository tree',
                context: GetRepositoryTreeUseCase.name,
                error: error,
                metadata: {
                    organizationId: params.organizationId,
                    repositoryId: params.repositoryId,
                },
            });
            return { repository: null, tree: [] };
        }
    }

    private formatAllTree(treeData: TreeItem[]): AllTreeItem[] {
        const rootDirectories: DirectoryStructure[] = [];
        const rootFiles: FileItem[] = [];
        const directoryMap = new Map<string, DirectoryStructure>();

        // Primeiro, criar todos os diretórios
        treeData
            .filter((item) => item.type === 'directory')
            .forEach((dir) => {
                const pathParts = dir.path.split('/');
                const dirName = pathParts[pathParts.length - 1];

                const directoryStructure: DirectoryStructure = {
                    name: dirName,
                    path: dir.path,
                    files: [],
                    subdirectories: [],
                };

                directoryMap.set(dir.path, directoryStructure);
            });

        // Adicionar arquivos aos diretórios correspondentes e coletar arquivos na raiz
        treeData
            .filter((item) => item.type === 'file')
            .forEach((file) => {
                const pathParts = file.path.split('/');
                const fileName = pathParts[pathParts.length - 1];
                const parentPath = pathParts.slice(0, -1).join('/');

                if (parentPath === '') {
                    // Arquivo na raiz - adicionar diretamente ao resultado top-level
                    rootFiles.push({ name: fileName, path: file.path });
                } else {
                    const parentDir = directoryMap.get(parentPath);
                    if (parentDir) {
                        parentDir.files.push({
                            name: fileName,
                            path: file.path,
                        });
                    }
                }
            });

        // Organizar hierarquia de diretórios
        directoryMap.forEach((dir, path) => {
            const pathParts = path.split('/');
            if (pathParts.length === 1) {
                // Diretório raiz
                rootDirectories.push(dir);
            } else {
                // Subdiretório
                const parentPath = pathParts.slice(0, -1).join('/');
                const parentDir = directoryMap.get(parentPath);
                if (parentDir) {
                    parentDir.subdirectories.push(dir);
                }
            }
        });

        // Retornar arquivos da raiz "soltos" seguidos pelos diretórios de topo
        return [...rootFiles, ...rootDirectories];
    }

    private formatDirectoriesOnly(treeData: TreeItem[]): DirectoryStructure[] {
        const rootDirectories: DirectoryStructure[] = [];
        const directoryMap = new Map<string, DirectoryStructure>();

        // Criar todos os diretórios
        treeData
            .filter((item) => item.type === 'directory')
            .forEach((dir) => {
                const pathParts = dir.path.split('/');
                const dirName = pathParts[pathParts.length - 1];

                const directoryStructure: DirectoryStructure = {
                    name: dirName,
                    path: dir.path,
                    files: [], // Sempre vazio para directories only
                    subdirectories: [],
                };

                directoryMap.set(dir.path, directoryStructure);
            });

        // Organizar hierarquia de diretórios
        directoryMap.forEach((dir, path) => {
            const pathParts = path.split('/');
            if (pathParts.length === 1) {
                // Diretório raiz
                rootDirectories.push(dir);
            } else {
                // Subdiretório
                const parentPath = pathParts.slice(0, -1).join('/');
                const parentDir = directoryMap.get(parentPath);
                if (parentDir) {
                    parentDir.subdirectories.push(dir);
                }
            }
        });

        return rootDirectories;
    }

    private formatFilesOnly(treeData: TreeItem[]): FileItem[] {
        return treeData
            .filter((item) => item.type === 'file')
            .map((file) => {
                const pathParts = file.path.split('/');
                const fileName = pathParts[pathParts.length - 1];

                return {
                    name: fileName,
                    path: file.path,
                };
            });
    }
}
