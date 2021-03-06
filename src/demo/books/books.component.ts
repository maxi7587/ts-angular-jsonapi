import * as Jsonapi from '../../library/index';

class BooksController implements ng.IController {
    public books: Jsonapi.ICollection;

    /** @ngInject */
    constructor(
        protected BooksService: Jsonapi.IService,
        protected $stateParams
    ) {

        // make filter (this is optional)
        let filter = {};
        if (this.$stateParams.filter.length > 0) {
            filter = { title : this.$stateParams.filter };
            // maybe you need a regular expresion ;)
            // filter = { title : /R.*/ };
        }

        this.books = BooksService.all(
            {
                localfilter: filter,
                remotefilter: {
                    date_published: {
                        since: '1983-01-01',
                        until: '2010-01-01'
                    }
                },
                page: { number: 2 },
                // storage_ttl: 15,
                include: ['author', 'photos']
            },
            success => {
                console.log('success books controller', success, this.books);

                /*** YOU CAN REMOVE THE NEXT TEST LINES **/

                // TEST 1
                // this test merge data with cache (this not include author or photos)
                console.log('BooksRequest#1 received (author data from server)',
                    (<Jsonapi.IResource>this.books[Object.keys(this.books)[2]].relationships.author.data).attributes
                );

                console.log('BooksRequest#2 requested');
                let books2 = this.BooksService.all(
                    success2 => {
                        console.log('BooksRequest#2 received (author data from cache)',
                            (<Jsonapi.IResource>books2[Object.keys(this.books)[1]].relationships.author.data)
                        );
                    }
                );

                // TEST 2
                console.log('BookRequest#3 requested');
                let book1 = this.BooksService.get(1,
                    success1 => {
                        console.log('BookRequest#3 received (author data from cache)',
                            (<Jsonapi.IResource>book1.relationships.author.data).attributes
                        );
                    });
            },
            error => {
                console.log('error books controller', error);
            }
        );
    }

    public $onInit() {

    }

    public delete(book: Jsonapi.IResource) {
        this.BooksService.delete(book.id);
    }
}

export class Books {
    public templateUrl = 'books/books.html';
    public controller = BooksController;
}
