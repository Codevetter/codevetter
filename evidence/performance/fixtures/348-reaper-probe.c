#include <sys/prctl.h>
#include <sys/wait.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
  if(argc < 3 || prctl(PR_SET_CHILD_SUBREAPER,1,0,0,0)) return 2;
  pid_t child=fork();
  if(child==0){execvp(argv[1],argv+1);_exit(127);}
  if(child<0)return 3;
  int status; if(waitpid(child,&status,0)!=child)return 4;
  int program_status=status;
  usleep(200000);
  unsigned zombies=0; siginfo_t info;
  while(waitid(P_ALL,0,&info,WEXITED|WNOHANG|WNOWAIT)==0 && info.si_pid) {
    zombies++;
    if(waitpid(info.si_pid,&status,0)<0)return 5;
  }
  int remaining=waitpid(-1,&status,WNOHANG);
  int all_reaped=remaining==-1 && errno==ECHILD;
  fprintf(stderr,"adopted_zombies_reaped_by_probe=%u program_exit=%d all_children_reaped=%d\n",zombies,WIFEXITED(program_status)?WEXITSTATUS(program_status):-1,all_reaped);
  return all_reaped && WIFEXITED(program_status) && WEXITSTATUS(program_status)==0 ? 0 : 6;
}
