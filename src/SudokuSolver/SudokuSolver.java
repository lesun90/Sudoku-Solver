package SudokuSolver;

public class SudokuSolver {
	public static int[][] gameTable = new int[][] {
			{ 9, 4, 5, 0, 0, 0, 0, 0, 0 },
			{ 0, 8, 0, 0, 0, 3, 0, 0, 0 },
			{ 0, 0, 0, 0, 2, 0, 0, 1, 0 },
			{ 5, 0, 3, 0, 0, 2, 9, 0, 0 },
			{ 0, 0, 9, 3, 0, 6, 4, 0, 0 },
			{ 0, 0, 7, 9, 0, 0, 8, 0, 3 },
			{ 0, 7, 0, 0, 4, 0, 0, 0, 0 },
			{ 0, 0, 0, 1, 0, 0, 0, 9, 0 },
			{ 0, 0, 0, 0, 0, 0, 7, 4, 6 }
			};

	public static GameData myGame = new GameData();

	public static void GameSolver() {
		myGame.initGame(gameTable);
		myGame.printGame();
		myGame.pencilMethod();

		if (myGame.validGame == false) {
			System.out.println("Invalid Game...");
			myGame.printGame();
			return;
		}

		if (myGame.isSolved() == true) {
			System.out.println("Solved...");
			myGame.printGame();
			return;
		}
		
		DFSSolver(myGame);

	}

	public static boolean DFSSolver(GameData GameBoard) {


		if (GameBoard.validGame == false) {
//			System.out.println("Invalid Game...");
			//myGame.printGame();
			return false;
		}

		if (GameBoard.isSolved() == true) {
			System.out.println("Solved...");
			GameBoard.printGame();
			return true;
		}
				
		for (int i = 0 ; i < 81; i ++)
		{
			if (GameBoard.gameCells[i].value == 0)
			{
				for (int p = 0 ; p < GameBoard.gameCells[i].pencilMark.size(); p++ )
				{
					GameData newBoard = new GameData();
					newBoard = GameBoard;
					newBoard.setCellValue(i, GameBoard.gameCells[i].pencilMark.get(p));
					newBoard.pencilMethod();
					if (DFSSolver(newBoard) == true)
					{
						return true;
					}
				}
			}
		}
		return false;
	}

	public static void main(String[] args) {
		GameSolver();
	}
}